const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeError(message, status, code, trace) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (trace) error.trace = trace;
  return error;
}

// Temporary problems worth retrying (overload, rate limit, network, bad model output).
function isCapacityError(error) {
  return [408, 429, 500, 502, 503, 504].includes(error.status) ||
    /RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|high demand|rate.?limit|capacity/i.test(error.message || "");
}

// Problems where trying the next model/provider makes sense.
// Auth errors (400/401/403, e.g. an invalid API key) are NOT included: they are
// thrown as-is so the real reason reaches the popup instead of being hidden.
function canFallback(error) {
  return isCapacityError(error) || error.code === "INVALID_OUTPUT" || error.status === 404;
}

function parseAnswer(raw) {
  const cleaned = String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw makeError("The model returned an invalid response format.", 502, "INVALID_OUTPUT");
  let parsed;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw makeError("The model returned malformed JSON.", 502, "INVALID_OUTPUT");
  }
  if (typeof parsed.answer !== "string" || !parsed.answer.trim()) {
    throw makeError("The model response did not contain a usable answer.", 502, "INVALID_OUTPUT");
  }
  const confidence = String(parsed.confidence).toLowerCase();
  return {
    answer: parsed.answer.trim(),
    explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
    confidence: ["high", "medium", "low"].includes(confidence) ? confidence : "medium"
  };
}

function buildPrompt({ question, options, answerType }) {
  return [
    "You are AnswerFlow, a careful educational question assistant.",
    "Explain the reasoning briefly and do not invent facts. If the question is ambiguous, say so.",
    "Provide a suggested answer for the user to review. Never claim that you selected, advanced, or submitted anything.",
    `Question: ${question}`,
    `Options:\n${options.length ? options.map((option, i) => `${String.fromCharCode(65 + i)}. ${option}`).join("\n") : "No options supplied"}`,
    `Requested format: ${answerType}`,
    'Return only JSON with exactly these keys: "answer", "explanation", "confidence".',
    'The confidence value must be "high", "medium", or "low". For MCQ, include the option letter and exact option text when possible.'
  ].join("\n\n");
}

async function geminiRequest({ prompt, model, apiKey }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      }),
      signal: AbortSignal.timeout(25000)
    });
  } catch (error) {
    throw makeError(
      error.name === "TimeoutError" ? `Gemini (${model}) timed out.` : `Could not reach the Gemini API (${error.message}).`,
      503,
      "NETWORK_ERROR"
    );
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Keep the real HTTP status so a bad key (400/403) or unknown model (404) is not mistaken for overload.
    throw makeError(data?.error?.message || `Gemini returned HTTP ${response.status}.`, response.status, data?.error?.status || "GEMINI_ERROR");
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw makeError("Gemini returned an empty response.", 502, "EMPTY_RESPONSE");
  return parseAnswer(text);
}

async function openAIRequest({ prompt, model, apiKey }) {
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Return careful educational help as valid JSON." },
          { role: "user", content: prompt }
        ]
      }),
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    throw makeError(
      error.name === "TimeoutError" ? "OpenAI request timed out." : `Could not reach the OpenAI API (${error.message}).`,
      503,
      "NETWORK_ERROR"
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw makeError(data?.error?.message || `OpenAI returned HTTP ${response.status}.`, response.status, "OPENAI_ERROR");
  }
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw makeError("OpenAI returned an empty response.", 502, "EMPTY_RESPONSE");
  return parseAnswer(text);
}

// Runs one model call and records it in the trace.
async function step(trace, label, model, fn) {
  const entry = { step: label, model, status: "running" };
  trace.push(entry);
  try {
    const result = await fn();
    entry.status = "success";
    return result;
  } catch (error) {
    entry.status = "failed";
    entry.reason = error.message;
    throw error;
  }
}

export async function generateAnswer(input) {
  const prompt = buildPrompt(input);
  const provider = input.provider || "auto";
  const trace = [];

  const geminiKey = process.env.GEMINI_API_KEY;
  const openAIKey = process.env.OPENAI_API_KEY;
  const primaryModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
  const openAIModel = process.env.OPENAI_MODEL || "gpt-4o-mini";

  let lastGeminiError = null;

  if (provider !== "openai") {
    if (!geminiKey) {
      if (provider === "gemini") {
        throw makeError("GEMINI_API_KEY is missing. Add it to backend/.env and restart the backend.", 503, "MISSING_KEY", trace);
      }
      trace.push({ step: "primary", model: primaryModel, status: "skipped", reason: "GEMINI_API_KEY is not configured" });
    } else {
      const models = [primaryModel, fallbackModel];
      for (let m = 0; m < models.length; m += 1) {
        const model = models[m];
        const attempts = m === 0 ? 2 : 1;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          try {
            const result = await step(trace, m === 0 ? "primary" : "fallback-model", model, () =>
              geminiRequest({ prompt, model, apiKey: geminiKey })
            );
            return { ...result, provider: "gemini", model, agent: { mode: provider, fallbackUsed: m > 0, trace } };
          } catch (error) {
            lastGeminiError = error;
            if (!canFallback(error)) {
              error.trace = trace; // e.g. invalid API key: surface the real message
              throw error;
            }
            if (error.status === 404) break; // unknown model name: retrying will not help
            if (attempt < attempts) await sleep(900);
          }
        }
      }
    }
  }

  if (provider === "openai" || (provider === "auto" && openAIKey)) {
    if (!openAIKey) {
      throw makeError("OPENAI_API_KEY is missing from backend/.env", 503, "MISSING_KEY", trace);
    }
    try {
      const result = await step(trace, "provider-fallback", openAIModel, () =>
        openAIRequest({ prompt, model: openAIModel, apiKey: openAIKey })
      );
      return { ...result, provider: "openai", model: openAIModel, agent: { mode: provider, fallbackUsed: provider === "auto", trace } };
    } catch (error) {
      error.trace = trace;
      throw error;
    }
  }

  const detail = lastGeminiError ? ` Last Gemini error: ${lastGeminiError.message}` : "";
  throw makeError(
    `Gemini is unavailable.${detail} Check GEMINI_MODEL / GEMINI_FALLBACK_MODEL in backend/.env, add OPENAI_API_KEY for a second-provider fallback, or retry shortly.`,
    503,
    "ALL_MODELS_UNAVAILABLE",
    trace
  );
}

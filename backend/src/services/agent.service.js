const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeError(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function isCapacityError(error) {
  return [408, 429, 500, 502, 503, 504].includes(error.status) ||
    /RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|high demand|rate.?limit|capacity/i.test(error.message || "");
}

function parseAnswer(raw) {
  const cleaned = String(raw || "")
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/, "")
    .trim();
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
  return {
    answer: parsed.answer.trim(),
    explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
    confidence: ["high", "medium", "low"].includes(String(parsed.confidence).toLowerCase())
      ? String(parsed.confidence).toLowerCase()
      : "medium"
  };
}

function buildPrompt({ question, options, answerType }) {
  return [
    "You are AnswerFlow, a careful educational question assistant.",
    "Explain the reasoning briefly and do not invent facts. If the question is ambiguous, say so.",
    "Provide a suggested answer for the user to review. Never claim that you submitted or selected anything.",
    `Question: ${question}`,
    `Options:\n${options.length ? options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join("\n") : "No options supplied"}`,
    `Requested format: ${answerType}`,
    'Return only JSON with exactly these keys: "answer", "explanation", "confidence".',
    'The confidence value must be "high", "medium", or "low". For MCQ, include the option letter and exact option text when possible.'
  ].join("\n\n");
}

async function geminiRequest({ prompt, model, apiKey }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      }),
      signal: AbortSignal.timeout(30000)
    });
  } catch (error) {
    throw makeError(error.name === "TimeoutError" ? "Gemini request timed out." : "Could not reach the Gemini API.", 503, "NETWORK_ERROR");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `Gemini returned HTTP ${response.status}.`;
    throw makeError(message, response.status, data?.error?.status || "GEMINI_ERROR");
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw makeError("Gemini returned an empty response.", 502, "EMPTY_RESPONSE");
  return parseAnswer(text);
}

async function openAIRequest({ prompt, apiKey }) {
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Return careful educational help as valid JSON." },
          { role: "user", content: prompt }
        ]
      }),
      signal: AbortSignal.timeout(30000)
    });
  } catch {
    throw makeError("Could not reach the OpenAI API.", 503, "NETWORK_ERROR");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw makeError(data?.error?.message || `OpenAI returned HTTP ${response.status}.`, response.status, "OPENAI_ERROR");
  }
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw makeError("OpenAI returned an empty response.", 502, "EMPTY_RESPONSE");
  return parseAnswer(text);
}

export async function runAnswerAgent(input) {
  const prompt = buildPrompt(input);
  const trace = [];
  const primaryModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        trace.push({ step: "primary", model: primaryModel, attempt, status: "running" });
        const result = await geminiRequest({ prompt, model: primaryModel, apiKey });
        trace[trace.length - 1].status = "success";
        return { ...result, provider: "gemini", model: primaryModel, agent: { mode: "auto", fallbackUsed: false, trace } };
      } catch (error) {
        trace[trace.length - 1].status = "failed";
        trace[trace.length - 1].reason = error.message;
        if (!isCapacityError(error)) throw error;
        if (attempt === 1) await sleep(900);
      }
    }

    try {
      trace.push({ step: "fallback-model", model: fallbackModel, attempt: 1, status: "running" });
      const result = await geminiRequest({ prompt, model: fallbackModel, apiKey });
      trace[trace.length - 1].status = "success";
      return { ...result, provider: "gemini", model: fallbackModel, agent: { mode: "auto", fallbackUsed: true, trace } };
    } catch (error) {
      trace[trace.length - 1].status = "failed";
      trace[trace.length - 1].reason = error.message;
      if (!isCapacityError(error) && error.status !== 404) throw error;
    }
  } else {
    trace.push({ step: "primary", model: primaryModel, status: "skipped", reason: "GEMINI_API_KEY is not configured" });
  }

  if (process.env.OPENAI_API_KEY) {
    try {
      trace.push({ step: "provider-fallback", model: "gpt-4o-mini", status: "running" });
      const result = await openAIRequest({ prompt, apiKey: process.env.OPENAI_API_KEY });
      trace[trace.length - 1].status = "success";
      return { ...result, provider: "openai", model: "gpt-4o-mini", agent: { mode: "auto", fallbackUsed: true, trace } };
    } catch (error) {
      trace[trace.length - 1].status = "failed";
      trace[trace.length - 1].reason = error.message;
      throw error;
    }
  }

  throw makeError(
    "Gemini is currently unavailable or overloaded. The agent tried its fallback model, but no OpenAI fallback key is configured. Please retry shortly or add OPENAI_API_KEY to backend/.env.",
    503,
    "ALL_MODELS_UNAVAILABLE"
  );
}

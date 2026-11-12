function parseJson(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The model returned an invalid response format.");
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (typeof parsed.answer !== "string" || !parsed.answer.trim()) throw new Error("The model response did not contain an answer.");
  return {
    answer: parsed.answer.trim(),
    explanation: typeof parsed.explanation === "string" ? parsed.explanation : "",
    confidence: ["high", "medium", "low"].includes(String(parsed.confidence).toLowerCase()) ? String(parsed.confidence).toLowerCase() : "medium"
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const capacityError = (error) => [408, 429, 500, 502, 503, 504].includes(error.status) ||
  /RESOURCE_EXHAUSTED|UNAVAILABLE|overloaded|high demand|rate.?limit|capacity/i.test(error.message || "");

function promptFor({ question, options, answerType }) {
  return [
    "You are AnswerFlow, a careful educational question assistant. Explain briefly. Do not invent facts; flag ambiguity.",
    "Provide a suggested answer for the user to review. Never claim that you selected, advanced, or submitted anything.",
    `Question: ${question}`,
    `Options:\n${options.length ? options.map((x, i) => `${String.fromCharCode(65 + i)}. ${x}`).join("\n") : "None supplied"}`,
    `Answer format: ${answerType}`,
    'Return only JSON with keys "answer", "explanation", "confidence". Confidence must be high, medium, or low. For MCQ include the letter and exact option text.'
  ].join("\n\n");
}

async function callGemini(prompt) {
  const key=process.env.GEMINI_API_KEY;
  if(!key) { const e=new Error('GEMINI_API_KEY is missing. Add it to backend/.env and restart the backend.'); e.status=503; throw e; }
  const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(key)}`;
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.2,responseMimeType:'application/json'}}),signal:AbortSignal.timeout(25000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) {
    const msg=data?.error?.message || `Gemini returned HTTP ${response.status}`;
    const e=new Error(msg); e.status=response.status===429?429:502; throw e;
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("");
  if (!text) throw new Error("Gemini returned an empty response.");
  return parseJson(text);
}

async function requestOpenAI(prompt, apiKey) {
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "developer", content: "Return accurate, concise educational help as JSON." },
          { role: "user", content: prompt }
        ]
      }),
      signal: AbortSignal.timeout(30000)
    });
  } catch {
    const e = new Error("Could not reach OpenAI.");
    e.status = 503;
    throw e;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const e = new Error(data?.error?.message || `OpenAI returned HTTP ${response.status}`);
    e.status = response.status;
    throw e;
  }
  return parseJson(data?.choices?.[0]?.message?.content);
}

export async function generateAnswer(input) {
  const prompt = promptFor(input);
  const trace = [];
  const requestedProvider = input.provider || "auto";
  const primaryModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const fallbackModel = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite";
  const geminiKey = process.env.GEMINI_API_KEY;
  const openAIKey = process.env.OPENAI_API_KEY;

  if (requestedProvider === "openai") {
    if (!openAIKey) {
      const e = new Error("OPENAI_API_KEY is missing from backend/.env");
      e.status = 503;
      throw e;
    }
    const result = await requestOpenAI(prompt, openAIKey);
    const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
    return { ...result, provider: "openai", model, agent: { fallbackUsed: false, trace: [{ model, status: "success" }] } };
  }

  if (!geminiKey) {
    if (requestedProvider === "gemini") {
      const e = new Error("GEMINI_API_KEY is missing from backend/.env");
      e.status = 503;
      throw e;
    }
    trace.push({ model: primaryModel, status: "skipped", reason: "GEMINI_API_KEY is not configured" });
  } else {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        trace.push({ model: primaryModel, attempt, status: "running" });
        const result = await requestGemini(prompt, primaryModel, geminiKey);
        trace[trace.length - 1].status = "success";
        return { ...result, provider: "gemini", model: primaryModel, agent: { fallbackUsed: false, trace } };
      } catch (error) {
        trace[trace.length - 1].status = "failed";
        trace[trace.length - 1].reason = error.message;
        if (!capacityError(error)) throw error;
        if (attempt === 1) await sleep(900);
      }
    }

    try {
      trace.push({ model: fallbackModel, status: "running" });
      const result = await requestGemini(prompt, fallbackModel, geminiKey);
      trace[trace.length - 1].status = "success";
      return { ...result, provider: "gemini", model: fallbackModel, agent: { fallbackUsed: true, trace } };
    } catch (error) {
      trace[trace.length - 1].status = "failed";
      trace[trace.length - 1].reason = error.message;
      if (!capacityError(error) && error.status !== 404) throw error;
    }
  }

  if (requestedProvider === "auto" && openAIKey) {
    const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
    try {
      trace.push({ model, status: "running" });
      const result = await requestOpenAI(prompt, openAIKey);
      trace[trace.length - 1].status = "success";
      return { ...result, provider: "openai", model, agent: { fallbackUsed: true, trace } };
    } catch (error) {
      trace[trace.length - 1].status = "failed";
      trace[trace.length - 1].reason = error.message;
      throw error;
    }
  }

  const error = new Error(requestedProvider === "gemini"
    ? "Both Gemini models are unavailable. Please retry shortly."
    : "Gemini is unavailable. Configure OPENAI_API_KEY in backend/.env to enable the second-provider fallback, or retry shortly.");
  error.status = 503;
  error.code = "ALL_MODELS_UNAVAILABLE";
  throw error;
}

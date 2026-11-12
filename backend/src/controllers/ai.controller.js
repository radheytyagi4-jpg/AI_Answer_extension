import { z } from "zod";
import { generateAnswer } from "../services/ai.service.js";

const schema = z.object({
  question: z.string().trim().min(1).max(10000),
  options: z.array(z.string().max(1000)).max(20).default([]),
  answerType: z.enum(["mcq", "short", "long"]).default("short"),
  provider: z.enum(["auto", "gemini", "openai"]).default("auto")
});

export async function answerQuestion(req, res) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  try {
    const result = await generateAnswer(parsed.data);
    return res.json(result);
  } catch (error) {
    console.error("[AnswerFlow Agent]", error.code || "ERROR", error.message);
    return res.status(error.status || 502).json({
      error: "AI agent request failed",
      message: error.message || "Provider request failed",
      code: error.code || "AGENT_ERROR"
    });
  }
}

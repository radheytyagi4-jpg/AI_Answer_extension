import { z } from "zod";
import { runAnswerAgent } from "../services/agent.service.js";

const schema = z.object({
  question: z.string().trim().min(1).max(10000),
  options: z.array(z.string().max(1000)).max(20).default([]),
  answerType: z.enum(["mcq", "short", "long"]).default("short")
});

export async function runAgent(req, res) {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  try {
    const result = await runAnswerAgent(parsed.data);
    return res.json(result);
  } catch (error) {
    console.error("[AnswerFlow Agent]", error.code || "ERROR", error.message);
    return res.status(error.status || 502).json({
      error: "Agent could not complete the request",
      message: error.message,
      code: error.code || "AGENT_ERROR"
    });
  }
}

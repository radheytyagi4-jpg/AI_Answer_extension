
import { z } from 'zod';
import { generateAnswer } from '../services/ai.service.js';

const schema = z.object({
  question:z.string().trim().min(1).max(10000),
  options:z.array(z.string().max(1000)).max(20).default([]),
  answerType:z.enum(['mcq','short','long']).default('short'),
  provider:z.enum(['gemini','openai']).default('gemini')
});

export async function answerQuestion(req,res) {
  const parsed=schema.safeParse(req.body);
  if(!parsed.success) return res.status(400).json({error:'Invalid request',details:parsed.error.flatten()});
  try {
    const result=await generateAnswer(parsed.data);
    res.json(result);
  } catch(error) {
    console.error('AI provider error:',error.message);
    const status=error.status || 502;
    res.status(status).json({error:'AI request failed',message:error.publicMessage || error.message || 'Provider request failed'});
  }
}

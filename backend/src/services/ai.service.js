
function parseJson(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
  const start=cleaned.indexOf('{'), end=cleaned.lastIndexOf('}');
  if(start<0 || end<start) throw new Error('The AI provider returned an unexpected response. Please retry.');
  return JSON.parse(cleaned.slice(start,end+1));
}

function promptFor({question,options,answerType}) {
  return `You are a careful educational tutor. Help the user understand the question and provide a suggested answer for review. Do not claim certainty when uncertain.
Question: ${question}
Options: ${options.length ? options.map((x,i)=>`${String.fromCharCode(65+i)}. ${x}`).join('\\n') : 'None supplied'}
Requested format: ${answerType}
Return ONLY valid JSON with keys "answer", "explanation", "confidence". For MCQ, include the option letter and exact option text when possible. Confidence must be "high", "medium", or "low".`;
}

async function callGemini(prompt) {
  const key=process.env.GEMINI_API_KEY;
  if(!key) { const e=new Error('GEMINI_API_KEY is missing. Add it to backend/.env and restart the backend.'); e.status=503; throw e; }
  const url=`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=${encodeURIComponent(key)}`;
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:0.2,responseMimeType:'application/json'}}),signal:AbortSignal.timeout(25000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) {
    const msg=data?.error?.message || `Gemini returned HTTP ${response.status}`;
    const e=new Error(msg); e.status=response.status===429?429:502; throw e;
  }
  const text=data?.candidates?.[0]?.content?.parts?.map(p=>p.text||'').join('');
  if(!text) throw new Error('Gemini returned an empty response.');
  return parseJson(text);
}

async function callOpenAI(prompt) {
  const key=process.env.OPENAI_API_KEY;
  if(!key) { const e=new Error('OPENAI_API_KEY is missing. Add it to backend/.env and restart the backend.'); e.status=503; throw e; }
  const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${key}`},body:JSON.stringify({model:'gpt-4o-mini',temperature:0.2,response_format:{type:'json_object'},messages:[{role:'system',content:'Return accurate, concise educational help as JSON.'},{role:'user',content:prompt}]}),signal:AbortSignal.timeout(25000)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok) { const e=new Error(data?.error?.message || `OpenAI returned HTTP ${response.status}`); e.status=response.status===429?429:502; throw e; }
  const text=data?.choices?.[0]?.message?.content;
  if(!text) throw new Error('OpenAI returned an empty response.');
  return parseJson(text);
}

export async function generateAnswer(input) {
  const prompt=promptFor(input);
  const result=input.provider==='openai' ? await callOpenAI(prompt) : await callGemini(prompt);
  if(typeof result.answer!=='string' || !result.answer.trim()) throw new Error('AI response did not contain an answer.');
  return {
    answer:result.answer.trim(),
    explanation:typeof result.explanation==='string'?result.explanation:'',
    confidence:['high','medium','low'].includes(result.confidence)?result.confidence:'medium',
    provider:input.provider
  };
}

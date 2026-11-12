
import { useEffect, useState } from 'react';
import { BrainCircuit, ScanText, Sparkles, Settings2, Copy, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';

const API = 'http://localhost:4000/api';

export default function App() {
  const [provider, setProvider] = useState('gemini');
  const [answerType, setAnswerType] = useState('mcq');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState([]);
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState('');

  useEffect(() => {
    const storage = globalThis.chrome?.storage?.local;

    if (storage) {
      storage.get(['provider', 'answerType']).then((v) => {
        if (v.provider) setProvider(v.provider);
        if (v.answerType) setAnswerType(v.answerType);
      }).catch(console.error);
    } else {
      // Fallback when running through Vite
      const provider = localStorage.getItem('provider');
      const answerType = localStorage.getItem('answerType');

      if (provider) setProvider(provider);
      if (answerType) setAnswerType(answerType);
    }
  }, []);

  async function saveSettings(p = provider, t = answerType) {
    const storage = globalThis.chrome?.storage?.local;

    if (storage) {
      await storage.set({ provider: p, answerType: t });
    } else {
      localStorage.setItem('provider', p);
      localStorage.setItem('answerType', t);
    }
  }

  async function detect() {
    setError(''); setAnswer(null); setStatus('Reading current tab…');
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab found.');
      const data = await chrome.tabs.sendMessage(tab.id, { type: 'ANSWERFLOW_DETECT' });
      if (!data?.question) throw new Error('Could not detect a question. Try selecting the question text and retrying.');
      setQuestion(data.question);
      setOptions(data.options || []);
      setStatus('Question detected');
    } catch (e) {
      setError(e.message || 'Could not read this page. Refresh the page and try again.');
      setStatus('Detection failed');
    }
  }

  async function askAI() {
    setBusy(true); setError(''); setAnswer(null); setStatus('Generating suggestion…');
    try {
      const res = await fetch(`${API}/ai/answer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, options, answerType, provider })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
      setAnswer(data);
      setStatus('Suggestion ready');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) chrome.tabs.sendMessage(tab.id, { type: 'ANSWERFLOW_SHOW_SUGGESTION', answer: `${data.answer}\n\n${data.explanation || ''}` }).catch(() => { });
    } catch (e) {
      setError(e.message || 'AI request failed.');
      setStatus('Request failed');
    } finally { setBusy(false); }
  }

  async function copyAnswer() {
    if (!answer?.answer) return;
    await navigator.clipboard.writeText(answer.answer);
    setStatus('Answer copied');
  }

  return <main className="app">
    <header className="header">
      <div className="brand-icon"><BrainCircuit size={22} /></div>
      <div className="brand-copy"><strong>AnswerFlow AI</strong><span>Question assistant</span></div>
      <Settings2 size={18} className="muted" />
    </header>

    <div className="status"><span className="dot" />{status}</div>

    <section className="field">
      <label>AI PROVIDER</label>
      <select value={provider} onChange={e => { setProvider(e.target.value); saveSettings(e.target.value, answerType); }}>
        <option value="gemini">Google Gemini</option>
        <option value="openai">OpenAI</option>
      </select>
    </section>
    <section className="field">
      <label>ANSWER FORMAT</label>
      <div className="segmented">
        {['mcq', 'short', 'long'].map(v => <button key={v} className={answerType === v ? 'selected' : ''} onClick={() => { setAnswerType(v); saveSettings(provider, v); }}>{v.toUpperCase()}</button>)}
      </div>
    </section>

    <button className="secondary" onClick={detect}><ScanText size={16} /> Read current question</button>

    <section className="question-box">
      <label>DETECTED QUESTION</label>
      <textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="Detected question will appear here. You can edit it." rows={4} />
      {options.length > 0 && <div className="options"><label>DETECTED OPTIONS</label>{options.map((o, i) => <div key={i}>{String.fromCharCode(65 + i)}. {o}</div>)}</div>}
    </section>

    <button className="primary" disabled={!question.trim() || busy} onClick={askAI}>
      {busy ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />}
      {busy ? 'Generating…' : 'Find answer'}
    </button>

    {error && <div className="error"><AlertCircle size={15} />{error}</div>}
    {answer && <section className="answer">
      <div className="answer-head"><CheckCircle2 size={16} /><strong>Suggested answer</strong></div>
      <p className="answer-text">{answer.answer}</p>
      {answer.explanation && <p className="explanation">{answer.explanation}</p>}
      {answer.confidence && <small>Confidence: {answer.confidence}</small>}
      <button className="secondary copy" onClick={copyAnswer}><Copy size={15} /> Copy answer</button>
    </section>}

    <footer>Review AI suggestions carefully. You control all page interactions and submission.</footer>
  </main>;
}

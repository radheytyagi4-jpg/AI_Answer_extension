import { useEffect, useState } from "react";
import { BrainCircuit, ScanText, Sparkles, Settings2, Copy, RefreshCw, AlertCircle, CheckCircle2, Workflow } from "lucide-react";

const API = "http://localhost:4000/api";

export default function App() {
  const [provider, setProvider] = useState("auto");
  const [answerType, setAnswerType] = useState("mcq");
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState([]);
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Agent ready");
  const [error, setError] = useState("");
  const [automation, setAutomation] = useState({ status: "idle", message: "Ready for an MCQ practice session.", completed: 0 });

  useEffect(() => {
    const storage = globalThis.chrome?.storage?.local;
    if (storage) {
      storage.get(["provider", "answerType"]).then((v) => {
        if (v.provider) setProvider(v.provider);
        if (v.answerType) setAnswerType(v.answerType);
      }).catch(console.error);
    } else {
      const savedProvider = localStorage.getItem("provider");
      const savedType = localStorage.getItem("answerType");
      if (savedProvider) setProvider(savedProvider);
      if (savedType) setAnswerType(savedType);
    }
  }, []);

  async function saveSettings(p = provider, t = answerType) {
    const storage = globalThis.chrome?.storage?.local;
    if (storage) await storage.set({ provider: p, answerType: t });
    else {
      localStorage.setItem("provider", p);
      localStorage.setItem("answerType", t);
    }
  }

  async function detect() {
    setError("");
    setAnswer(null);
    setStatus("Reading current tab…");
    try {
      const tabsApi = globalThis.chrome?.tabs;
      if (!tabsApi) throw new Error("Page detection is available in the installed extension. You can paste a question here while using the web preview.");
      const [tab] = await tabsApi.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab found.");
      const data = await tabsApi.sendMessage(tab.id, { type: "ANSWERFLOW_DETECT" });
      if (!data?.question) throw new Error("Could not detect a question. Refresh the page and try again.");
      setQuestion(data.question);
      setOptions(data.options || []);
      setStatus("Question detected");
    } catch (e) {
      setError(e.message || "Could not read this page.");
      setStatus("Detection failed");
    }
  }

  async function askAI() {
    setBusy(true);
    setError("");
    setAnswer(null);
    setStatus(provider === "auto" ? "Agent selecting an available model…" : "Contacting " + provider + "…");
    try {
      const res = await fetch(`${API}/ai/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, options, answerType, provider })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || `Request failed (${res.status})`);
      setAnswer(data);
      setStatus(data.agent?.fallbackUsed ? "Fallback model responded" : "Suggestion ready");
      const tabsApi = globalThis.chrome?.tabs;
      if (tabsApi) {
        const [tab] = await tabsApi.query({ active: true, currentWindow: true });
        if (tab?.id) tabsApi.sendMessage(tab.id, {
          type: "ANSWERFLOW_SHOW_SUGGESTION",
          answer: `${data.answer}

${data.explanation || ""}`
        }).catch(() => {});
      }
    } catch (e) {
      setError(e.message || "AI request failed.");
      setStatus("Agent needs attention");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const runtime = globalThis.chrome?.runtime;
    if (!runtime?.onMessage) return;
    const listener = (message) => {
      if (message?.type === "ANSWERFLOW_PROGRESS") setAutomation({ status: message.status, message: message.message, completed: message.completed || 0 });
    };
    runtime.onMessage.addListener(listener);
    return () => runtime.onMessage.removeListener(listener);
  }, []);

  async function startAutomation() {
    setError("");
    const tabsApi = globalThis.chrome?.tabs;
    const runtime = globalThis.chrome?.runtime;
    if (!tabsApi || !runtime) { setError("Automation works in the installed Chrome extension, not the Vite preview."); return; }
    try {
      const [tab] = await tabsApi.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error("No active tab found.");
      const result = await runtime.sendMessage({ type: "ANSWERFLOW_START", tabId: tab.id, provider, answerType: "mcq" });
      if (!result?.ok) throw new Error(result?.error || "Could not start automation.");
      setAutomation({ status: "running", message: "Agent started.", completed: 0 });
    } catch (e) { setError(e.message || "Could not start automation."); }
  }

  async function stopAutomation() {
    try { await globalThis.chrome?.runtime?.sendMessage({ type: "ANSWERFLOW_STOP" }); } catch {}
    setAutomation((current) => ({ ...current, status: "paused", message: "Stop requested. The agent will stop after its current safe step." }));
  }

  async function copyAnswer() {
    if (!answer?.answer) return;
    await navigator.clipboard.writeText(answer.answer);
    setStatus("Answer copied");
  }

  return <main className="app">
    <header className="header">
      <div className="brand-icon"><BrainCircuit size={22} /></div>
      <div className="brand-copy"><strong>CHEETAH AI</strong><span>Multi-model answer agent</span></div>
      <Settings2 size={18} className="muted" />
    </header>

    <div className="status"><span className="dot" />{status}</div>

    <section className="agent-banner">
      <Workflow size={18} />
      <div><strong>Auto Agent enabled</strong><span>Retries temporary Gemini overload and switches models when needed.</span></div>
    </section>

    <section className="field">
      <label>MODEL ROUTING</label>
      <select value={provider} onChange={e => { setProvider(e.target.value); saveSettings(e.target.value, answerType); }}>
        <option value="auto">Auto — recommended</option>
        <option value="gemini">Gemini only</option>
        <option value="openai">OpenAI only</option>
      </select>
    </section>
    <section className="field">
      <label>ANSWER FORMAT</label>
      <div className="segmented">
        {["mcq", "short", "long"].map(v => <button key={v} className={answerType === v ? "selected" : ""} onClick={() => { setAnswerType(v); saveSettings(provider, v); }}>{v.toUpperCase()}</button>)}
      </div>
    </section>

    <button className="secondary" onClick={detect}><ScanText size={16} /> Read current question</button>

    <section className="automation-box">
      <div className="automation-heading"><Workflow size={16} /><strong>MCQ practice automation</strong></div>
      <p>{automation.message}</p>
      <small>Questions handled: {automation.completed}</small>
      {automation.status === "running"
        ? <button className="stop-button" onClick={stopAutomation}>Stop automation</button>
        : <button className="primary" onClick={startAutomation}>Start MCQ agent</button>}
      <small className="automation-note">Selects detected options and uses Next only. It never submits the quiz. Review the final page yourself.</small>
    </section>

    <section className="question-box">
      <label>QUESTION</label>
      <textarea value={question} onChange={e => setQuestion(e.target.value)} placeholder="Read a question from the current page or paste it here." rows={4} />
      {options.length > 0 && <div className="options"><label>DETECTED OPTIONS</label>{options.map((o, i) => <div key={i}>{String.fromCharCode(65 + i)}. {o}</div>)}</div>}
    </section>

    <button className="primary" disabled={!question.trim() || busy} onClick={askAI}>
      {busy ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />}
      {busy ? "Agent working…" : "Find answer"}
    </button>

    {error && <div className="error"><AlertCircle size={15} />{error}</div>}
    {answer && <section className="answer">
      <div className="answer-head"><CheckCircle2 size={16} /><strong>Suggested answer</strong></div>
      <p className="answer-text">{answer.answer}</p>
      {answer.explanation && <p className="explanation">{answer.explanation}</p>}
      {answer.confidence && <small>Confidence: {answer.confidence}</small>}
      {answer.model && <small className="model-used">Model used: {answer.model}{answer.agent?.fallbackUsed ? " · fallback" : ""}</small>}
      {answer.agent?.trace?.length > 0 && <div className="agent-trace"><strong>Agent activity</strong>{answer.agent.trace.map((step, i) => <div key={i}><span>{step.model}</span><span className={step.status}>{step.status}</span></div>)}</div>}
      <button className="secondary copy" onClick={copyAnswer}><Copy size={15} /> Copy answer</button>
    </section>}

    <footer>Review suggestions carefully. The agent stops at the final question; submission always stays manual.</footer>
  </main>;
}

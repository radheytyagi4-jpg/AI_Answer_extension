let stopRequested = false;
let running = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sendProgress = (tabId, payload) => chrome.runtime.sendMessage({ type: "ANSWERFLOW_PROGRESS", ...payload }).catch(() => {});
const pageMessage = (tabId, message) => chrome.tabs.sendMessage(tabId, message);

async function runWorkflow({ tabId, provider = "auto", answerType = "mcq" }) {
  if (running) throw new Error("An AnswerFlow run is already active.");
  running = true;
  stopRequested = false;
  let completed = 0;
  try {
    for (let index = 1; index <= 100; index += 1) {
      if (stopRequested) { sendProgress(tabId, { status: "paused", message: "Stopped by you.", completed }); return; }
      sendProgress(tabId, { status: "running", message: `Reading question ${index}…`, completed });
      const detected = await pageMessage(tabId, { type: "ANSWERFLOW_DETECT" });
      if (!detected?.question) {
        sendProgress(tabId, { status: "stopped", message: "No question detected. Check the page and restart.", completed });
        return;
      }
      if (!detected.options?.length) {
        sendProgress(tabId, { status: "stopped", message: "No MCQ options detected. Stopped without changing the page.", completed });
        return;
      }
      const response = await fetch("http://localhost:4000/api/ai/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: detected.question, options: detected.options, answerType, provider })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || data.error || `AI request failed (${response.status})`);
      if (stopRequested) { sendProgress(tabId, { status: "paused", message: "Stopped by you before selecting the answer.", completed }); return; }
      const selected = await pageMessage(tabId, { type: "ANSWERFLOW_SELECT", answer: data.answer, options: detected.options });
      if (!selected?.ok) {
        sendProgress(tabId, { status: "stopped", message: `Could not safely match answer: ${selected?.reason || "unknown error"}`, completed });
        return;
      }
      completed += 1;
      sendProgress(tabId, { status: "running", message: `Selected option for question ${index}. Moving to Next…`, completed, answer: data.answer, explanation: data.explanation });
      await sleep(500);
      if (stopRequested) { sendProgress(tabId, { status: "paused", message: "Stopped by you. Current answer remains selected.", completed }); return; }
      const next = await pageMessage(tabId, { type: "ANSWERFLOW_NEXT" });
      if (!next?.ok) {
        sendProgress(tabId, { status: "finished", message: "Reached the final question or no Next button was found. Review your answers and submit manually if ready.", completed });
        return;
      }
      await sleep(900);
    }
    sendProgress(tabId, { status: "stopped", message: "Safety limit reached (100 questions). Review the page before continuing.", completed });
  } catch (error) {
    sendProgress(tabId, { status: "error", message: error.message || "Agent workflow failed.", completed });
  } finally {
    running = false;
    stopRequested = false;
  }
}

chrome.runtime.onInstalled.addListener(() => console.info("AnswerFlow AI installed"));
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "ANSWERFLOW_START") {
    const tabId = msg.tabId;
    if (!Number.isInteger(tabId)) { sendResponse({ ok: false, error: "No active tab." }); return; }
    runWorkflow({ tabId, provider: msg.provider, answerType: msg.answerType })
      .catch((error) => sendProgress(tabId, { status: "error", message: error.message, completed: 0 }));
    sendResponse({ ok: true });
    return;
  }
  if (msg?.type === "ANSWERFLOW_STOP") {
    stopRequested = true;
    sendResponse({ ok: true });
    return;
  }
});
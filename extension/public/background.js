
let stopRequested = false;
let running = false;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function sendProgress(tabId, payload) {
  chrome.runtime.sendMessage({
    type: "ANSWERFLOW_PROGRESS",
    ...payload
  }).catch(() => {});
}


async function pageMessage(tabId, message) {
  const send = () =>
    Promise.race([
      chrome.tabs.sendMessage(tabId, message),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Page response timed out. Refresh the page.")),
          5000
        )
      )
    ]);

  try {
    return await send();
  } catch (error) {
    const connectionError =
      /receiving end does not exist|could not establish connection/i.test(
        error.message || ""
      );

    if (!connectionError) {
      throw error;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });

      await sleep(300);

      return await send();
    } catch (injectionError) {
      throw new Error(
        "Could not load content.js into this tab. Open a normal website, refresh it, and try again. " +
        (injectionError.message || "")
      );
    }
  }
}


async function askAI(question, options, provider, answerType) {
  const controller = new AbortController();

  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch(
      "http://localhost:4000/api/ai/answer",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          options,
          provider,
          answerType
        }),
        signal: controller.signal
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.message || data.error || `AI error ${response.status}`);
    }

    if (!data.answer) {
      throw new Error("AI did not return an answer.");
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("AI request timed out after 20 seconds.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runWorkflow({ tabId, provider = "auto", answerType = "mcq" }) {
  if (running) throw new Error("Automation is already running.");

  running = true;
  stopRequested = false;

  let completed = 0;

  try {
    for (let index = 1; index <= 100; index++) {
      if (stopRequested) break;

      sendProgress(tabId, {
        status: "running",
        message: `Detecting question ${index}...`,
        completed
      });

      const detected = await pageMessage(tabId, {
        type: "ANSWERFLOW_DETECT"
      });

      if (!detected?.question || detected.options?.length < 2) {
        sendProgress(tabId, {
          status: "stopped",
          message: detected?.reason || "No valid MCQ detected.",
          completed
        });
        return;
      }

      sendProgress(tabId, {
        status: "running",
        message: `Question ${index} detected. Asking AI...`,
        completed
      });

      const data = await askAI(
        detected.question,
        detected.options,
        provider,
        answerType
      );

      if (stopRequested) break;

      sendProgress(tabId, {
        status: "running",
        message: `AI answered question ${index}. Selecting option...`,
        completed
      });

      const selected = await pageMessage(tabId, {
        type: "ANSWERFLOW_SELECT",
        answer: data.answer,
        options: detected.options
      });

      if (!selected?.ok) {
        sendProgress(tabId, {
          status: "stopped",
          message: selected?.reason || "Answer selection failed.",
          completed
        });
        return;
      }

      completed++;

      sendProgress(tabId, {
        status: "running",
        message: `Question ${index} answered. Checking Next button...`,
        completed
      });

      await sleep(700);

      if (stopRequested) break;

      const next = await pageMessage(tabId, {
        type: "ANSWERFLOW_NEXT"
      });

      if (!next?.ok) {
        sendProgress(tabId, {
          status: "finished",
          message: "No Next button found. Review your answers manually.",
          completed
        });
        return;
      }

      await sleep(1200);
    }

    sendProgress(tabId, {
      status: "paused",
      message: "Automation stopped. Review the current page.",
      completed
    });

  } catch (error) {
    sendProgress(tabId, {
      status: "error",
      message: error.message || "Automation failed.",
      completed
    });
  } finally {
    running = false;
    stopRequested = false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.info("AnswerFlow AI installed");
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "ANSWERFLOW_START") {
    if (!Number.isInteger(msg.tabId)) {
      sendResponse({ ok: false, error: "No active tab found." });
      return;
    }

    if (running) {
      sendResponse({ ok: false, error: "Automation is already running." });
      return;
    }

    runWorkflow({
      tabId: msg.tabId,
      provider: msg.provider,
      answerType: msg.answerType
    });

    sendResponse({ ok: true });
    return;
  }

  if (msg?.type === "ANSWERFLOW_STOP") {
    stopRequested = true;
    sendResponse({ ok: true });
    return;
  }
});

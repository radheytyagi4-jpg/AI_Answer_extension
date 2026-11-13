(() => {
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect(), st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none";
  };
  const optionSelector = 'input[type="radio"], [role="radio"], input[type="checkbox"], [role="checkbox"]';

  function detectQuestion() {
    const roots = [...document.querySelectorAll('fieldset,[role="radiogroup"],[role="group"],form,main,article')]
      .filter(visible);
    let best = null;
    for (const root of roots) {
      const controls = [...root.querySelectorAll(optionSelector)].filter(visible);
      if (!controls.length) continue;
      const options = controls.map((el) => {
        const label = el.labels?.[0] || el.closest("label");
        return clean(label?.innerText || el.getAttribute("aria-label") || el.parentElement?.innerText || "");
      }).filter(Boolean);
      const lines = (root.innerText || "").split(/\\n+/).map(clean).filter(Boolean);
      const optionSet = new Set(options);
      const questionLines = lines.filter((line) => ![...optionSet].some((o) => line === o || line.includes(o)));
      const question = questionLines.find((line) => line.length > 12 && line.length < 1200) || questionLines.slice(0, 3).join(" ");
      const score = controls.length * 10 + Math.min(question.length / 100, 5);
      if (question && (!best || score > best.score)) best = { question, options: [...new Set(options)], score };
    }
    if (best) return { question: best.question, options: best.options.slice(0, 20) };
    const text = (document.body?.innerText || "").split(/\\n+/).map(clean).filter(Boolean);
    return { question: text.find((line) => line.length > 12 && line.length < 1200) || "", options: [] };
  }

  function findAnswerControl(answer, options) {
    const raw = clean(answer);
    const letter = raw.match(/^\\s*([A-Z])(?:[.)\\s:-]|$)/i)?.[1]?.toUpperCase();
    const answerText = raw.replace(/^\\s*[A-Z](?:[.)\\s:-]+)?/i, "").trim().toLowerCase();
    const controls = [...document.querySelectorAll(optionSelector)].filter(visible);
    const candidates = controls.map((el) => {
      const label = el.labels?.[0] || el.closest("label");
      const text = clean(label?.innerText || el.getAttribute("aria-label") || el.parentElement?.innerText || "");
      return { el, text, lower: text.toLowerCase() };
    });
    if (letter && options?.length && candidates[letter.charCodeAt(0) - 65]) {
      const target = options[letter.charCodeAt(0) - 65]?.toLowerCase();
      const match = candidates.find((x) => x.lower === target) || candidates[letter.charCodeAt(0) - 65];
      if (match) return match.el;
    }
    return candidates.find((x) => x.lower === answerText || (answerText && x.lower.includes(answerText)) || (x.lower && answerText.includes(x.lower)))?.el || null;
  }

  function selectAnswer(answer, options) {
    const control = findAnswerControl(answer, options);
    if (!control) return { ok: false, reason: "Could not match the AI answer to a visible option." };
    const label = control.labels?.[0] || control.closest("label");
    const target = label || control;
    target.click();
    if (control.type === "radio" || control.type === "checkbox") {
      control.checked = true;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return { ok: true, selected: clean(label?.innerText || control.getAttribute("aria-label") || control.parentElement?.innerText || "") };
  }

  function findNextButton() {
    const elements = [...document.querySelectorAll('button,input[type="button"],input[type="submit"],[role="button"],a')]
      .filter(visible);
    const next = elements.find((el) => {
      const text = clean(el.innerText || el.value || el.getAttribute("aria-label") || "").toLowerCase();
      return /^(next|next question|continue|save\s*&\s*next|next\s*→|→)$/.test(text) &&
        !/submit|finish|complete|final/.test(text) &&
        !el.disabled && el.getAttribute("aria-disabled") !== "true";
    });
    return next || null;
  }

  function clickNext() {
    const button = findNextButton();
    if (!button) return { ok: false, final: true, reason: "No enabled Next button found. Stopped for your review; nothing was submitted." };
    button.click();
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "ANSWERFLOW_DETECT") { sendResponse(detectQuestion()); return; }
    if (msg?.type === "ANSWERFLOW_SELECT") { sendResponse(selectAnswer(msg.answer, msg.options || [])); return; }
    if (msg?.type === "ANSWERFLOW_NEXT") { sendResponse(clickNext()); return; }
    if (msg?.type === "ANSWERFLOW_SHOW_SUGGESTION") {
      let panel = document.getElementById("answerflow-suggestion");
      if (!panel) {
        panel = document.createElement("aside");
        panel.id = "answerflow-suggestion";
        panel.style.cssText = "position:fixed;z-index:2147483647;right:18px;bottom:18px;width:320px;max-height:45vh;overflow:auto;background:#111a13;color:#e8f5eb;border:1px solid #3b6b48;border-radius:14px;padding:14px;font:13px/1.5 system-ui;box-shadow:0 10px 40px #0008";
        document.documentElement.appendChild(panel);
      }
      panel.textContent = msg.answer || "No answer returned.";
      sendResponse({ ok: true }); return;
    }
  });
})();
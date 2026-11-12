
(() => {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
  };

  function detectQuestion() {
    const candidates = [...document.querySelectorAll('fieldset, [role="radiogroup"], [role="group"], form, main, article, body')]
      .filter(visible);
    let best = null;
    for (const root of candidates) {
      const inputs = [...root.querySelectorAll('input[type="radio"], input[type="checkbox"], [role="radio"], [role="checkbox"]')].filter(visible);
      const labels = inputs.map((input, i) => {
        let label = input.labels?.[0]?.innerText || input.closest('label')?.innerText ||
          input.parentElement?.innerText || input.getAttribute('aria-label') || '';
        return clean(label);
      }).filter(Boolean);
      const text = clean(root.innerText).slice(0, 9000);
      if (!text) continue;
      const score = (labels.length * 3) + Math.min(text.length / 250, 10);
      if (!best || score > best.score) best = { text, options: [...new Set(labels)], score };
    }
    if (best) {
      const lines = best.text.split(/\n+/).map(clean).filter(Boolean);
      const question = lines.find(line => line.length > 15 && line.length < 600) || lines.slice(0,3).join(' ');
      return { question, options: best.options.slice(0,15), pageText: best.text };
    }
    const text = clean(document.body?.innerText).slice(0, 9000);
    const lines = text.split(/\n+/).map(clean).filter(Boolean);
    return { question: lines.find(x => x.length > 15 && x.length < 600) || text.slice(0,600), options: [], pageText: text };
  }

  function showSuggestion(answer) {
    let panel = document.getElementById('answerflow-suggestion');
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = 'answerflow-suggestion';
      panel.style.cssText = 'position:fixed;z-index:2147483647;right:18px;bottom:18px;width:320px;max-height:45vh;overflow:auto;background:#111a13;color:#e8f5eb;border:1px solid #3b6b48;border-radius:14px;padding:14px;font:13px/1.5 system-ui;box-shadow:0 10px 40px #0008';
      document.documentElement.appendChild(panel);
    }
    panel.innerHTML = '';
    const title = document.createElement('strong'); title.textContent = 'AnswerFlow suggestion';
    const body = document.createElement('p'); body.textContent = answer;
    const close = document.createElement('button'); close.textContent = 'Close';
    close.style.cssText = 'padding:7px 12px;border:0;border-radius:8px;background:#8ce6a3;color:#102015;cursor:pointer';
    close.addEventListener('click', () => panel.remove());
    panel.append(title, body, close);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'ANSWERFLOW_DETECT') {
      sendResponse(detectQuestion());
      return true;
    }
    if (msg?.type === 'ANSWERFLOW_SHOW_SUGGESTION') {
      showSuggestion(msg.answer || 'No answer returned.');
      sendResponse({ ok: true });
      return true;
    }
  });
})();

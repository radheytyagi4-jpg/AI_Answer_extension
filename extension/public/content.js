
(() => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  const isShown = (node) => {
    const r = node.getBoundingClientRect();
    const s = getComputedStyle(node);
    return r.width > 0 && r.height > 0 &&
      s.display !== "none" && s.visibility !== "hidden";
  };

  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    if (isShown(el)) return true;
    // Styled quizzes often hide the real <input>; accept it if its label is visible.
    if (el.tagName === "INPUT") {
      const label = el.labels?.[0] || el.closest("label");
      return !!label && isShown(label);
    }
    return false;
  };

  const selector =
    'input[type="radio"], [role="radio"], input[type="checkbox"], [role="checkbox"]';

  const normalize = (s) =>
    clean(s).replace(/^([A-H])\s*[.)\-:]\s*/i, "").trim();

  function labelText(el) {
    const label = el.labels?.[0] || el.closest("label");

    return clean(
      label?.innerText ||
      el.getAttribute("aria-label") ||
      el.parentElement?.innerText ||
      ""
    );
  }

  function isHeading(text) {
    return /^(question|questions|detected options|options|answer choices|instructions?)[:：]?$/i.test(text);
  }

  function detectQuestion() {
    const controls = [...document.querySelectorAll(selector)].filter(visible);

    if (controls.length < 2) {
      return {
        question: "",
        options: [],
        reason: "Less than two visible answer options found."
      };
    }

    const groups = new Map();

    for (const control of controls) {
      let root = control.closest(
        'fieldset,[role="radiogroup"],[data-question],.question,.quiz-question'
      );

      if (!root) {
        let node = control.parentElement;

        for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
          const count = [...node.querySelectorAll(selector)].filter(visible).length;

          if (count >= 2 && count <= 10) {
            root = node;
            break;
          }
        }
      }

      if (!root) continue;

      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(control);
    }

    const candidates = [];

    for (const [root, group] of groups) {
      const unique = [...new Set(group)];

      if (unique.length < 2 || unique.length > 10) continue;

      const rawOptions = unique.map(labelText);
      if (rawOptions.some(x => !x)) continue;

      const options = rawOptions.map(normalize);

      const optionSet = new Set(
        rawOptions.map(x => clean(x).toLowerCase())
      );

      const lines = (root.innerText || "")
        .split(/\n+/)
        .map(clean)
        .filter(Boolean);

      const questionLines = lines.filter(line => {
        if (isHeading(line)) return false;

        if (optionSet.has(line.toLowerCase())) return false;

        if (/^[A-H]\s*[.)\-:]\s*/i.test(line)) return false;

        if (/^(next|previous|submit|finish|continue)\b/i.test(line)) return false;

        return line.length >= 6 && line.length <= 1000;
      });

      const question = questionLines
        .sort((a, b) => b.length - a.length)[0] || "";

      if (!question) continue;

      candidates.push({
        question,
        options,
        // Prefer unanswered questions, then the one nearest the top of the page.
        score:
          unique.length * 10 +
          Math.min(question.length / 100, 5) -
          (unique.some(c => c.checked || c.getAttribute("aria-checked") === "true") ? 1000 : 0) -
          Math.max(0, root.getBoundingClientRect().top) / 10000
      });
    }

    candidates.sort((a, b) => b.score - a.score);

    if (!candidates.length) {
      return {
        question: "",
        options: [],
        reason: "Could not identify a real question and its answer options."
      };
    }

    return {
      question: candidates[0].question,
      options: candidates[0].options
    };
  }

  function findAnswerControl(answer, options) {
    const raw = clean(answer);

    // Only treat it as an option letter when followed by . ) : - (so "A triangle..." is not read as option A).
    const letter = raw.match(/^(?:option\s+)?([A-H])(?:[.):-]|$)/i)?.[1]?.toUpperCase();

    const answerText = normalize(raw).toLowerCase();

    const controls = [...document.querySelectorAll(selector)].filter(visible);

    const candidates = controls.map(el => ({
      el,
      text: normalize(labelText(el)).toLowerCase()
    }));

    if (letter && options?.length) {
      const index = letter.charCodeAt(0) - 65;
      const target = normalize(options[index] || "").toLowerCase();

      const match = candidates.find(x => x.text === target);

      if (match) return match.el;
    }

    return candidates.find(x =>
      x.text === answerText ||
      (answerText && x.text.includes(answerText))
    )?.el || null;
  }

  function selectAnswer(answer, options) {
    const control = findAnswerControl(answer, options);

    if (!control) {
      return {
        ok: false,
        reason: "Could not match the AI answer to a visible option."
      };
    }

    const label = control.labels?.[0] || control.closest("label");

    (label || control).click();

    if (control.type === "radio" || control.type === "checkbox") {
      control.checked = true;
      control.dispatchEvent(new Event("input", { bubbles: true }));
      control.dispatchEvent(new Event("change", { bubbles: true }));
    }

    return {
      ok: true,
      selected: labelText(control)
    };
  }

  function findNextButton() {
    const elements = [
      ...document.querySelectorAll(
        'button,input[type="button"],[role="button"],a'
      )
    ].filter(visible);

    return elements.find(el => {
      const text = clean(
        el.innerText || el.value || el.getAttribute("aria-label") || ""
      ).toLowerCase().replace(/[\s→›»>▶➔➜]+$/u, ""); // allow "Next →", "Next ›", "Next »"

      return /^(next|next question|continue|save\s*&\s*next)$/.test(text) &&
        !el.disabled &&
        el.getAttribute("aria-disabled") !== "true";
    }) || null;
  }

  function clickNext() {
    const button = findNextButton();

    if (!button) {
      return {
        ok: false,
        final: true,
        reason: "No enabled Next button found. Manual review required."
      };
    }

    button.click();
    return { ok: true };
  }

  function showSuggestion(text) {
    document.getElementById("answerflow-suggestion")?.remove();
    const box = document.createElement("div");
    box.id = "answerflow-suggestion";
    box.style.cssText =
      "position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:340px;padding:12px 14px;" +
      "background:#17251a;color:#e8eee9;border:1px solid #3c6947;border-radius:10px;" +
      "font:13px/1.5 system-ui,sans-serif;white-space:pre-wrap;box-shadow:0 6px 24px rgba(0,0,0,.35);cursor:pointer";
    box.textContent = text.trim() + "\n\n(click to dismiss)";
    box.addEventListener("click", () => box.remove());
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 30000);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === "ANSWERFLOW_SHOW_SUGGESTION") {
      showSuggestion(String(msg.answer || ""));
      sendResponse({ ok: true });
      return;
    }

    if (msg?.type === "ANSWERFLOW_DETECT") {
      sendResponse(detectQuestion());
      return;
    }

    if (msg?.type === "ANSWERFLOW_SELECT") {
      sendResponse(selectAnswer(msg.answer, msg.options || []));
      return;
    }

    if (msg?.type === "ANSWERFLOW_NEXT") {
      sendResponse(clickNext());
      return;
    }
  });
})();

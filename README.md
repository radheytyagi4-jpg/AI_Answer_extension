# AnswerFlow AI

React + Vite browser extension (Manifest V3) with a Node.js/Express AI backend and multi-model answer agent.

## Install

Requires Node.js 20+.

```bash
npm install
```

## Configure models

Copy `backend/.env.example` to `backend/.env`.

- `GEMINI_API_KEY`: required for the primary Gemini path.
- `GEMINI_MODEL`: defaults to `gemini-3.8-flash`.
- `GEMINI_FALLBACK_MODEL`: defaults to `gemini-3.5-flash-lite`.
- `OPENAI_API_KEY`: optional second-provider fallback.
- `OPENAI_MODEL`: defaults to `gpt-5.4-mini`.

API keys stay on the backend and are never bundled into the extension. Do not commit `backend/.env`.

## Agent behavior

When **Auto — recommended** is selected, the backend agent:

1. Calls the configured primary Gemini model.
2. Retries once after a short delay for temporary overload, rate-limit, or service errors.
3. Switches to the configured Gemini fallback model.
4. If both Gemini models remain unavailable, tries OpenAI when `OPENAI_API_KEY` is configured.
5. Returns the model used and an activity trace to the extension UI.

The UI shows whether a fallback was used. You can also select Gemini-only or OpenAI-only routing.

## Run locally

```bash
npm run dev
```

Extension preview: http://localhost:5173  
Backend: http://localhost:4000

The web preview supports manually pasting a question. Page detection requires the installed extension.

## Load the browser extension

```bash
npm run build
```

Open `chrome://extensions` (or `edge://extensions`), enable Developer mode, click **Load unpacked**, and select `extension/dist`.

## Workflow

1. Open a page containing a question.
2. Open AnswerFlow and choose **Read current question**.
3. Review the detected question and options.
4. Choose Auto Agent and an answer format.
5. Review the suggested answer, explanation, confidence, and model activity.

The extension provides user-reviewed learning and practice suggestions. It does not automatically complete graded assessments, advance through questions, or submit forms.

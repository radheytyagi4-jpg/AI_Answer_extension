# AnswerFlow AI

React + Vite Chrome extension (Manifest V3) with a Node.js/Express backend and multi-model AI answer agent.

## Install

Requires Node.js 20+.

```bash
npm install
```

## Configure models

Copy `backend/.env.example` to `backend/.env`.

- `GEMINI_API_KEY`: required for Gemini.
- `GEMINI_MODEL`: defaults to `gemini-3.8-flash`.
- `GEMINI_FALLBACK_MODEL`: defaults to `gemini-3.5-flash-lite`.
- `OPENAI_API_KEY`: optional second-provider fallback.
- `OPENAI_MODEL`: configurable OpenAI model (defaults to `gpt-5.4-mini`).

API keys stay on the backend and are never bundled into the extension. Never commit `backend/.env`.

## AI agent behavior

Auto routing calls the primary Gemini model, retries temporary capacity/rate-limit failures, switches to the Gemini fallback model, and then tries OpenAI if configured. The API response includes the model used and an agent trace.

## Run locally

```bash
npm run dev
```

Extension preview: http://localhost:5173  
Backend: http://localhost:4000

The web preview supports manually pasting a question. Page detection and page automation require the installed Chrome extension.

## Load the extension

```bash
npm run build
```

Open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `extension/dist`.

## MCQ practice workflow

1. Open an MCQ practice page.
2. Start the local backend and open AnswerFlow.
3. Choose the model routing preference.
4. Click **Start MCQ agent**.
5. The extension reads a question and its options, requests an AI answer, selects the matching visible option, and clicks a clearly labelled Next control.
6. Use **Stop automation** whenever you want to pause.

The workflow has a 100-question safety limit. It stops when it cannot confidently detect an MCQ or match an answer, or when no enabled Next control is found. It does not click Submit, Finish, or Complete. At the end, review your answers and submit manually if you choose.

Page layouts differ. The current detector supports common radio/checkbox-based MCQ forms; custom quiz widgets may need site-specific selectors. Always supervise the automation and verify selected answers.

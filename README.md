# AnswerFlow AI

React + Vite Chrome Extension (Manifest V3) with a Node.js/Express AI backend.

## Install
Requires Node.js 20+.

```bash
npm install
```

## Configure an AI provider
Copy `backend/.env.example` to `backend/.env` and add at least one API key.
- Gemini: `GEMINI_API_KEY=...`
- OpenAI: `OPENAI_API_KEY=...`

Keys stay on the backend and are never bundled into the extension.

## Run
```bash
npm run dev
```
Extension UI: http://localhost:5173  
Backend: http://localhost:4000

## Load into Chrome
```bash
npm run build
```
Open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select `extension/dist`.

## Workflow
1. Open a page containing a question.
2. Open the extension and choose **Read current question**.
3. Review the detected question and options.
4. Choose an AI provider and answer style, then request a suggestion.
5. Review the suggested answer and explanation.
6. If appropriate, manually apply the suggestion using the page's own controls and continue yourself.

The extension intentionally does not automatically answer graded assessments, advance through questions, or submit forms. It can assist with learning and authorized practice by suggesting answers for review. Submission remains the user's decision.

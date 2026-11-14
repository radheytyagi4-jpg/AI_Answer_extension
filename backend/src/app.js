import express from 'express';
import cors from 'cors';
import healthRoutes from './routes/health.routes.js';
import aiRoutes from './routes/ai.routes.js';

const app = express();

// Only the extension (and the local Vite preview) may call this API from a browser.
// Without this, any website you visit could spend your Gemini/OpenAI quota.
const isAllowedOrigin = (origin) =>
  !origin ||
  origin.startsWith('chrome-extension://') ||
  /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin);

app.use(cors({ origin: (origin, callback) => callback(null, isAllowedOrigin(origin)) }));
app.use(express.json({ limit: '256kb' })); // multibyte text (e.g. Hindi) is 3 bytes/char
app.use('/api', healthRoutes);
app.use('/api/ai', aiRoutes);

// JSON errors instead of Express's default HTML error page.
app.use((err, _req, res, _next) => {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request too large', message: 'The question and options are too large to send.', code: 'PAYLOAD_TOO_LARGE' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid request', message: 'Request body is not valid JSON.', code: 'BAD_JSON' });
  }
  console.error('[AnswerFlow API]', err);
  return res.status(500).json({ error: 'Server error', message: 'Unexpected server error.', code: 'SERVER_ERROR' });
});

export default app;

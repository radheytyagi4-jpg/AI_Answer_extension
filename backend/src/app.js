
import express from 'express';
import cors from 'cors';
import healthRoutes from './routes/health.routes.js';
import aiRoutes from './routes/ai.routes.js';

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '32kb' }));
app.use('/api', healthRoutes);
app.use('/api/ai', aiRoutes);
export default app;

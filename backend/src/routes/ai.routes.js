
import { Router } from 'express';
import { answerQuestion } from '../controllers/ai.controller.js';
const router = Router();
router.post('/answer',answerQuestion);
export default router;

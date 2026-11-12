import { Router } from "express";
import { runAgent } from "../controllers/agent.controller.js";

const router = Router();
router.post("/answer", runAgent);

export default router;

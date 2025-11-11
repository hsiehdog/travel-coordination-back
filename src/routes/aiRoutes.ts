import { Router } from "express";
import { generateAiCompletion } from "../controllers/aiController";
import { requireAuth } from "../middleware/authMiddleware";

const router = Router();

router.post("/generate", requireAuth, generateAiCompletion);

export default router;

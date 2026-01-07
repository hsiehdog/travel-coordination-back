import { Router } from "express";
import { reconstructTrip } from "../controllers/aiController";
import { requireAuth } from "../middleware/authMiddleware";

const router = Router();

router.post("/reconstruct", requireAuth, reconstructTrip);

export default router;

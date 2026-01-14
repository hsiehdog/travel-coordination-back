import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware";
import { resolvePendingActionHandler } from "../controllers/pendingActionController";

const router = Router();

router.post("/:pendingActionId/resolve", requireAuth, resolvePendingActionHandler);

export default router;

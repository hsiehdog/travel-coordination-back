import { Router } from "express";
import { getProfile, listSessions } from "../controllers/userController";
import { requireAuth } from "../middleware/authMiddleware";

const router = Router();

router.get("/me", requireAuth, getProfile);
router.get("/me/sessions", requireAuth, listSessions);

export default router;

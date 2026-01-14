import { Router } from "express";
import userRoutes from "./userRoutes";
import aiRoutes from "./aiRoutes";
import tripRoutes from "./tripRoutes";
import pendingActionRoutes from "./pendingActionRoutes";

const router = Router();

router.use("/users", userRoutes);
router.use("/ai", aiRoutes);
router.use("/trips", tripRoutes);
router.use("/pending-actions", pendingActionRoutes);

export default router;

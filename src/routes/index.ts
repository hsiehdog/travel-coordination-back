import { Router } from "express";
import userRoutes from "./userRoutes";
import aiRoutes from "./aiRoutes";
import tripRoutes from "./tripRoutes";

const router = Router();

router.use("/users", userRoutes);
router.use("/ai", aiRoutes);
router.use("/trips", tripRoutes);

export default router;

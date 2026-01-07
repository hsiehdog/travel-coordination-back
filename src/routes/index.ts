import { Router } from "express";
import userRoutes from "./userRoutes";
import aiRoutes from "./aiRoutes";

const router = Router();

router.use("/users", userRoutes);
router.use("/ai", aiRoutes);

export default router;

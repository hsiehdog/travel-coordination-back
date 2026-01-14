import { Router } from "express";
import { requireAuth } from "../middleware/authMiddleware";
import {
  createTrip,
  getTripDetail,
  ingestTripDetails,
  listTrips,
  reconstructIntoTrip,
  renameTrip,
} from "../controllers/tripController";

const router = Router();

router.post("/", requireAuth, createTrip);
router.get("/", requireAuth, listTrips);
router.get("/:tripId", requireAuth, getTripDetail);
router.post("/:tripId/reconstruct", requireAuth, reconstructIntoTrip);
router.post("/:tripId/ingest", requireAuth, ingestTripDetails);
router.patch("/:tripId", requireAuth, renameTrip);

export default router;

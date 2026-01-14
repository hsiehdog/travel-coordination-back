import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { reconstructService } from "../services/reconstructService";
import { ingestTripUpdate } from "../services/ingestService";
import { tripService } from "../services/tripService";

const CreateTripSchema = z.object({
  title: z.string().min(1).max(120),
});

const RenameTripSchema = z.object({
  title: z.string().min(1).max(120),
});

const ReconstructInTripSchema = z.object({
  rawText: z.string().min(1).max(250_000),
  client: z.object({
    timezone: z.string().min(1),
    nowIso: z.string().min(1).optional(),
  }),
});

const IngestTripSchema = z.object({
  rawUpdateText: z.string().min(1).max(250_000),
  client: z.object({
    timezone: z.string().min(1),
    nowIso: z.string().min(1).optional(),
  }),
  mode: z.enum(["patch", "rebuild"]).optional(),
});

export const createTrip = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateTripSchema.parse(req.body);
    const trip = await tripService.createTrip({
      userId: req.user!.id,
      title: parsed.title.trim(),
    });

    res.status(201).json({
      trip: {
        id: trip.id,
        title: trip.title,
        status: trip.status,
        createdAt: trip.createdAt,
        updatedAt: trip.updatedAt,
      },
    });
  }
);

export const listTrips = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const trips = await tripService.listTrips(req.user!.id);
    res.status(200).json({ trips });
  }
);

const GetTripDetailParamSchema = z.object({
  tripId: z.string().min(1),
});

export const getTripDetail = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const paramsParsed = GetTripDetailParamSchema.parse(req.params);
    const detail = await tripService.getTripDetail(
      req.user!.id,
      paramsParsed.tripId
    );

    res.status(200).json({
      trip: {
        id: detail.trip.id,
        title: detail.trip.title,
        status: detail.trip.status,
        createdAt: detail.trip.createdAt,
        updatedAt: detail.trip.updatedAt,
      },
      latestRun: detail.latestRun,
      runs: detail.runs,
      tripItems: detail.tripItems,
    });
  }
);

const ReconstructInTripParamSchema = z.object({
  tripId: z.string().min(1),
});

export const reconstructIntoTrip = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ReconstructInTripSchema.parse(req.body);
    const paramsParsed = ReconstructInTripParamSchema.parse(req.params);
    const tripId = paramsParsed.tripId;

    const { trip, combinedRawText, truncation } =
      await tripService.appendTripSource(
        req.user!.id,
        tripId,
        parsed.rawText
      );

    const reconstruction = await reconstructService({
      userId: req.user!.id,
      rawText: combinedRawText,
      client: parsed.client,
      tripId,
      inputMeta: truncation
        ? {
            rawTextTruncated: true,
            rawTextOriginalChars: truncation.originalChars,
            rawTextKeptChars: truncation.keptChars,
            rawTextOmittedChars: truncation.omittedChars,
          }
        : undefined,
    });

    if (trip.title.trim() === "Untitled Trip") {
      await tripService.renameTrip({
        userId: req.user!.id,
        tripId,
        title: reconstruction.tripTitle,
      });
    }

    res.status(200).json(reconstruction);
  }
);

export const ingestTripDetails = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const parsed = IngestTripSchema.parse(req.body);
    const paramsParsed = ReconstructInTripParamSchema.parse(req.params);
    const tripId = paramsParsed.tripId;

    const response = await ingestTripUpdate({
      userId: req.user!.id,
      tripId,
      rawUpdateText: parsed.rawUpdateText,
      client: parsed.client,
      mode: parsed.mode,
    });

    res.status(200).json(response);
  }
);

const RenameTripParamSchema = z.object({
  tripId: z.string().min(1),
});

export const renameTrip = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const parsed = RenameTripSchema.parse(req.body);
    const paramsParsed = RenameTripParamSchema.parse(req.params);
    const tripId = paramsParsed.tripId;

    const trip = await tripService.renameTrip({
      userId: req.user!.id,
      tripId,
      title: parsed.title.trim(),
    });

    res.status(200).json({
      trip: {
        id: trip.id,
        title: trip.title,
        status: trip.status,
        createdAt: trip.createdAt,
        updatedAt: trip.updatedAt,
      },
    });
  }
);

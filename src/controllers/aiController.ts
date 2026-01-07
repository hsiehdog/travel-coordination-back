import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { reconstructService } from "../services/reconstructService";

const ReconstructRequestSchema = z.object({
  rawText: z.string().min(1).max(250_000),
  client: z.object({
    timezone: z.string().min(1),
    nowIso: z.string().min(1).optional(),
  }),
});

/**
 * POST /ai/reconstruct
 *
 * Protected route.
 * Reconstructs a trip from pasted text and returns validated TripReconstruction JSON.
 */
export const reconstructTrip = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id; // Non-null assertion since requireAuth ensures user is present
    const parsed = ReconstructRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: "INVALID_REQUEST",
          message: "Invalid request body.",
          details: z.treeifyError(parsed.error),
        },
      });
      return;
    }

    const { rawText, client } = parsed.data;

    const reconstruction = await reconstructService({
      userId,
      rawText,
      client,
    });

    res.status(200).json(reconstruction);
  }
);

import type { Request, Response } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { resolvePendingAction } from "../services/ingestService";

const ResolvePendingActionSchema = z.object({
  selectedItemId: z.string().min(1),
});

const ResolvePendingActionParamSchema = z.object({
  pendingActionId: z.string().min(1),
});

export const resolvePendingActionHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const paramsParsed = ResolvePendingActionParamSchema.parse(req.params);
    const parsed = ResolvePendingActionSchema.parse(req.body);

    const response = await resolvePendingAction({
      userId: req.user!.id,
      pendingActionId: paramsParsed.pendingActionId,
      selectedItemId: parsed.selectedItemId,
    });

    res.status(200).json(response);
  }
);

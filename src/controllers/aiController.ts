import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { aiService } from "../services/aiService";
import { ApiError } from "../middleware/errorHandler";

const aiPromptSchema = z.object({
  prompt: z.string().min(1, "prompt is required"),
});

export const generateAiCompletion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { prompt } = aiPromptSchema.parse(req.body);

    if (!req.user) {
      throw new ApiError("Unauthorized", 401);
    }

    const result = await aiService.generateResponse({
      prompt,
      userId: req.user.id,
    });

    res.json({
      data: result,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      next(new ApiError("Invalid request body", 400, error.flatten()));
      return;
    }

    next(error);
  }
};

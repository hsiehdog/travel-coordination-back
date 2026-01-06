import { Request, Response as ExpressResponse } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler";
import { userService } from "../services/userService";

const updateNameSchema = z.object({
  name: z.string().min(1, "Name is required").max(120, "Name is too long"),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8, "Current password is required"),
  newPassword: z.string().min(8, "New password must be at least 8 characters"),
  revokeOtherSessions: z.boolean().optional(),
});

export const getProfile = asyncHandler(
  async (req: Request, res: ExpressResponse): Promise<void> => {
    res.json({ user: req.user });
  }
);

export const listSessions = asyncHandler(
  async (req: Request, res: ExpressResponse): Promise<void> => {
    const sessions = await userService.listSessions(req.user!.id); // Non-null assertion since requireAuth ensures user is present

    res.json({ sessions });
  }
);

export const updateDisplayName = asyncHandler(
  async (req: Request, res: ExpressResponse): Promise<void> => {
    const { name } = updateNameSchema.parse(req.body);
    const result = await userService.updateDisplayName(req.headers, name);

    res.json(result);
  }
);

export const changePassword = asyncHandler(
  async (req: Request, res: ExpressResponse): Promise<void> => {
    const { currentPassword, newPassword, revokeOtherSessions } =
      changePasswordSchema.parse(req.body);

    const result = await userService.changePassword(req.headers, {
      currentPassword,
      newPassword,
      revokeOtherSessions,
    });

    res.json(result);
  }
);

export const signOut = asyncHandler(
  async (req: Request, res: ExpressResponse): Promise<void> => {
    const response = await userService.signOut(req.headers);
    await userService.relayAuthResponse(res, response);
  }
);

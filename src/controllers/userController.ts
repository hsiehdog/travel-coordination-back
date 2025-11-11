import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";

export const getProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({
      user: req.user,
    });
  } catch (error) {
    next(error);
  }
};

export const listSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const sessions = await prisma.aiSession.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    res.json({ sessions });
  } catch (error) {
    next(error);
  }
};

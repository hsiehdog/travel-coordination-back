import type { RequestHandler } from "express";
import { auth } from "../lib/auth";
import { headersFromExpress } from "../utils/http";

export const attachAuthContext: RequestHandler = async (req, _res, next) => {
  try {
    if (req.path.startsWith("/auth")) {
      next();
      return;
    }

    const session = await auth.api
      .getSession({
        headers: headersFromExpress(req.headers),
      })
      .catch(() => null);

    if (session?.user) {
      req.user = session.user as Express.User;
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  next();
};

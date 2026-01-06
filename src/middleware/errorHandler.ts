import { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

export class ApiError extends Error {
  statusCode: number;
  details?: unknown;

  constructor(message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const notFoundHandler = (_req: Request, _res: Response, next: NextFunction): void => {
  next(new ApiError("Resource not found", 404));
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const errorHandler = (error: Error | ApiError, _req: Request, res: Response, _next: NextFunction): void => {
  if (error instanceof ZodError) {
    res.status(400).json({ message: "Invalid request body", errors: error.flatten() });
    return;
  }

  const status = (error as ApiError).statusCode ?? 500;
  const payload = {
    message: error.message || "Internal server error",
    details: (error as ApiError).details,
  };

  res.status(status).json(payload);
};

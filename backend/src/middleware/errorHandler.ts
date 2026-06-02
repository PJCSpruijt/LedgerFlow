import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError, ConnectorError } from "../utils/errors.js";
import { logger } from "../config/logger.js";

/**
 * Centralized error middleware. Must be registered last.
 * Maps AppError → status, ZodError → 400, anything else → 500.
 * Never leaks stack traces or internal messages in production.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    if (err instanceof ConnectorError) {
      // ConnectorError.details carry raw upstream (Yuki) snippets/faults — useful
      // in logs, never safe to return. Expose ONLY the safe, actionable fields so
      // the UI can tell a temporary daily-limit (rateLimited) from a hard error.
      if (err.details !== undefined) logger.warn({ code: err.code, details: err.details }, err.message);
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          details: { rateLimited: err.rateLimited, connector: err.connector },
        },
      });
      return;
    }
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? undefined,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.flatten(),
      },
    });
    return;
  }

  logger.error({ err }, "Unhandled error");
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
    },
  });
};

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
};

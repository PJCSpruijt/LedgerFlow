import type { RequestHandler } from "express";
import { ZodSchema } from "zod";

/**
 * Validate `req.body` / `req.query` / `req.params` against a Zod schema.
 * On success the parsed value replaces the original (so types match).
 */
export function validateBody<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return next(parsed.error);
    req.body = parsed.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) return next(parsed.error);
    // Express 5 makes req.query a getter — assign onto a local symbol via Object.defineProperty.
    Object.defineProperty(req, "query", { value: parsed.data, configurable: true });
    next();
  };
}

export function validateParams<T>(schema: ZodSchema<T>): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.params);
    if (!parsed.success) return next(parsed.error);
    req.params = parsed.data as unknown as typeof req.params;
    next();
  };
}

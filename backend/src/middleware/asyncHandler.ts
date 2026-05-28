import type { Request, Response, NextFunction, RequestHandler } from "express";

/** Wraps async handlers so thrown errors flow to the error middleware. */
export const asyncHandler =
  <Req extends Request = Request>(
    fn: (req: Req, res: Response, next: NextFunction) => Promise<unknown>,
  ): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req as Req, res, next)).catch(next);
  };

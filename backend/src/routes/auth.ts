import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import { login, logout, refresh, register } from "../services/auth.service.js";

export const authRouter = Router();

// Stricter rate limit on auth endpoints to slow credential stuffing.
const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters"),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  organizationName: z.string().min(1).max(120),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const REFRESH_COOKIE = "lf_refresh";
const refreshCookieOpts = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/auth",
};

authRouter.post(
  "/register",
  authLimiter,
  validateBody(RegisterSchema),
  asyncHandler(async (req, res) => {
    const result = await register(req.body);
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOpts);
    res.status(201).json({
      user: result.user,
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
    });
  }),
);

authRouter.post(
  "/login",
  authLimiter,
  validateBody(LoginSchema),
  asyncHandler(async (req, res) => {
    const result = await login(req.body);
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOpts);
    res.json({
      user: result.user,
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
    });
  }),
);

authRouter.post(
  "/refresh",
  authLimiter,
  asyncHandler(async (req, res) => {
    const raw =
      (req.cookies?.[REFRESH_COOKIE] as string | undefined) ||
      (req.body?.refreshToken as string | undefined);
    if (!raw) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: "No refresh token" } });
      return;
    }
    const tokens = await refresh(raw);
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOpts);
    res.json({
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
    });
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await logout(raw);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOpts);
    res.json({ ok: true });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);

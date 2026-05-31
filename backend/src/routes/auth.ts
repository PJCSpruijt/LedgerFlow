import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { UserTokenKind } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { validateBody } from "../middleware/validate.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth } from "../middleware/auth.js";
import {
  completePasswordSetup,
  isTwoFactorChallenge,
  login,
  loginVerifyTwoFactor,
  logout,
  refresh,
  register,
} from "../services/auth.service.js";
import {
  generateTotpSecret,
  totpKeyUri,
  totpQrDataUrl,
  verifyTotp,
} from "../services/totp.service.js";
import { encryptString, decryptString } from "../utils/crypto.js";
import { BadRequestError } from "../utils/errors.js";

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
  workspaceName: z.string().min(1).max(120),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const TwoFactorLoginSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(6).max(10),
});

const PasswordSetupSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(10, "Wachtwoord moet minstens 10 tekens zijn"),
});

const CodeSchema = z.object({ code: z.string().min(6).max(10) });

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
    if (isTwoFactorChallenge(result)) {
      res.json({ twoFactorRequired: true, challengeToken: result.challengeToken });
      return;
    }
    res.cookie(REFRESH_COOKIE, result.refreshToken, refreshCookieOpts);
    res.json({
      user: result.user,
      accessToken: result.accessToken,
      accessTokenExpiresAt: result.accessTokenExpiresAt,
    });
  }),
);

authRouter.post(
  "/login/2fa",
  authLimiter,
  validateBody(TwoFactorLoginSchema),
  asyncHandler(async (req, res) => {
    const result = await loginVerifyTwoFactor(req.body.challengeToken, req.body.code);
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

/** Accept an admin invitation: consume the token and set the initial password. */
authRouter.post(
  "/accept-invitation",
  authLimiter,
  validateBody(PasswordSetupSchema),
  asyncHandler(async (req, res) => {
    await completePasswordSetup(req.body.token, UserTokenKind.INVITE, req.body.password);
    res.json({ ok: true });
  }),
);

/** Complete a password reset: consume the token and set the new password. */
authRouter.post(
  "/reset-password",
  authLimiter,
  validateBody(PasswordSetupSchema),
  asyncHandler(async (req, res) => {
    await completePasswordSetup(req.body.token, UserTokenKind.PASSWORD_RESET, req.body.password);
    res.json({ ok: true });
  }),
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        platformRole: true,
        twoFactorEnabled: true,
        twoFactorRequired: true,
        avatarUrl: true,
        dashboardWidgets: true,
      },
    });
    res.json({ user });
  }),
);

/** Save the current user's dashboard widget preferences (list of disabled keys). */
const DashboardWidgetsSchema = z.object({ disabled: z.array(z.string().max(60)).max(50) });
authRouter.put(
  "/me/dashboard",
  requireAuth,
  validateBody(DashboardWidgetsSchema),
  asyncHandler(async (req, res) => {
    const { disabled } = req.body as z.infer<typeof DashboardWidgetsSchema>;
    await prisma.user.update({ where: { id: req.user!.id }, data: { dashboardWidgets: disabled } });
    res.json({ dashboardWidgets: disabled });
  }),
);

const AvatarSchema = z.object({
  // A client-resized image as a data: URL. Capped (~220KB) so it stays small.
  dataUrl: z
    .string()
    .regex(/^data:image\/(png|jpe?g|webp|gif);base64,/, "Ongeldige afbeelding")
    .max(300_000, "Afbeelding te groot (max ~220KB na verkleinen)"),
});

/** Set the current user's profile picture. */
authRouter.put(
  "/me/avatar",
  requireAuth,
  validateBody(AvatarSchema),
  asyncHandler(async (req, res) => {
    const { dataUrl } = req.body as z.infer<typeof AvatarSchema>;
    await prisma.user.update({ where: { id: req.user!.id }, data: { avatarUrl: dataUrl } });
    res.json({ avatarUrl: dataUrl });
  }),
);

/** Remove the current user's profile picture (fall back to initials). */
authRouter.delete(
  "/me/avatar",
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.user.update({ where: { id: req.user!.id }, data: { avatarUrl: null } });
    res.json({ ok: true });
  }),
);

/* -------------------------------------------------------------------------- */
/*  Self-service 2FA (TOTP) enrollment                                        */
/* -------------------------------------------------------------------------- */

/** Begin enrollment: generate (and store, disabled) a secret; return QR + secret. */
authRouter.post(
  "/2fa/setup",
  requireAuth,
  asyncHandler(async (req, res) => {
    const secret = generateTotpSecret();
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { twoFactorSecret: encryptString(secret), twoFactorEnabled: false },
    });
    const otpauthUri = totpKeyUri(req.user!.email, secret);
    const qrDataUrl = await totpQrDataUrl(otpauthUri);
    res.json({ secret, otpauthUri, qrDataUrl });
  }),
);

/** Confirm enrollment by verifying the first code; flips twoFactorEnabled on. */
authRouter.post(
  "/2fa/enable",
  requireAuth,
  validateBody(CodeSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.twoFactorSecret) {
      throw new BadRequestError("Start eerst de 2FA-installatie");
    }
    if (!verifyTotp(req.body.code, decryptString(user.twoFactorSecret))) {
      throw new BadRequestError("Ongeldige verificatiecode");
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true },
    });
    res.json({ ok: true, twoFactorEnabled: true });
  }),
);

/** Disable 2FA (requires a valid code). Blocked when an admin has required 2FA. */
authRouter.post(
  "/2fa/disable",
  requireAuth,
  validateBody(CodeSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) {
      throw new BadRequestError("2FA is niet ingeschakeld");
    }
    if (user.twoFactorRequired) {
      throw new BadRequestError("Je beheerder heeft 2FA verplicht; je kunt het niet uitschakelen.");
    }
    if (!verifyTotp(req.body.code, decryptString(user.twoFactorSecret))) {
      throw new BadRequestError("Ongeldige verificatiecode");
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    res.json({ ok: true, twoFactorEnabled: false });
  }),
);

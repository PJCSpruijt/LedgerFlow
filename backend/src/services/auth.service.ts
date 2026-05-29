import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
import { PlatformRole, ScopedRole, ScopeLevel, UserTokenKind } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { decryptString } from "../utils/crypto.js";
import { verifyTotp } from "./totp.service.js";
import { BadRequestError, ConflictError, UnauthorizedError } from "../utils/errors.js";

const BCRYPT_ROUNDS = 12;

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  workspaceName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

export interface AuthResult extends AuthTokens {
  user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    platformRole: PlatformRole;
  };
}

/** Hash a raw refresh token for safe DB storage. */
function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function parseTtl(value: string): number {
  // crude duration parser: supports "15m", "30d", "12h", "60s", or raw seconds
  const m = /^(\d+)([smhd])?$/.exec(value);
  if (!m) throw new Error(`Invalid TTL: ${value}`);
  const n = Number(m[1]);
  const unit = m[2] ?? "s";
  switch (unit) {
    case "s": return n * 1000;
    case "m": return n * 60_000;
    case "h": return n * 3_600_000;
    case "d": return n * 86_400_000;
  }
  return n * 1000;
}

function signAccessToken(
  userId: string,
  email: string,
  platformRole: PlatformRole,
): { token: string; expiresAt: Date } {
  const expiresAt = new Date(Date.now() + parseTtl(env.JWT_ACCESS_TTL));
  const opts: SignOptions = { expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"] };
  // prole = platform role. It's baked into the short-lived (≤15m) access token so
  // requireAuth needs no per-request DB lookup; a role change propagates on the
  // next refresh. Authorization for scoped resources is still re-checked per request.
  const token = jwt.sign({ sub: userId, email, prole: platformRole }, env.JWT_ACCESS_SECRET, opts);
  return { token, expiresAt };
}

function generateRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(48).toString("base64url");
  const hash = hashRefreshToken(raw);
  const expiresAt = new Date(Date.now() + parseTtl(env.JWT_REFRESH_TTL));
  return { raw, hash, expiresAt };
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (existing) throw new ConflictError("Email already registered");

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  // Create user + their first workspace (with a default group + entity) +
  // workspace-admin membership + subscription, all in one transaction.
  const { user } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
      },
    });
    const workspace = await tx.workspace.create({
      data: {
        name: input.workspaceName,
        groups: {
          create: {
            name: input.workspaceName,
            entities: { create: { name: input.workspaceName } },
          },
        },
      },
    });
    await tx.membership.create({
      data: {
        userId: user.id,
        scopeLevel: ScopeLevel.WORKSPACE,
        role: ScopedRole.WORKSPACE_ADMIN,
        workspaceId: workspace.id,
      },
    });
    await tx.subscription.create({
      data: { workspaceId: workspace.id, status: "NONE" },
    });
    await tx.auditLog.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        action: "user.registered",
        metadata: { email: user.email },
      },
    });
    return { user };
  });

  const tokens = await issueTokens(user.id, user.email, user.platformRole);

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      platformRole: user.platformRole,
    },
    ...tokens,
  };
}

/** Returned by login() when the account has 2FA enabled: a second step is needed. */
export interface TwoFactorChallenge {
  twoFactorRequired: true;
  challengeToken: string;
}

export function isTwoFactorChallenge(
  r: AuthResult | TwoFactorChallenge,
): r is TwoFactorChallenge {
  return (r as TwoFactorChallenge).twoFactorRequired === true;
}

export async function login(input: LoginInput): Promise<AuthResult | TwoFactorChallenge> {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user) throw new UnauthorizedError("Invalid credentials");

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new UnauthorizedError("Invalid credentials");

  // 2FA gate: password verified, but issue no tokens yet — hand back a short-lived
  // challenge the client exchanges (with a TOTP code) at /auth/login/2fa.
  if (user.twoFactorEnabled && user.twoFactorSecret) {
    return { twoFactorRequired: true, challengeToken: signChallengeToken(user.id) };
  }

  const tokens = await issueTokens(user.id, user.email, user.platformRole);

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      platformRole: user.platformRole,
    },
    ...tokens,
  };
}

const CHALLENGE_TTL = "5m";

function signChallengeToken(userId: string): string {
  return jwt.sign({ sub: userId, typ: "2fa" }, env.JWT_ACCESS_SECRET, { expiresIn: CHALLENGE_TTL });
}

function verifyChallengeToken(token: string): string {
  let decoded: jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
  } catch {
    throw new UnauthorizedError("Verlopen of ongeldige 2FA-sessie. Log opnieuw in.");
  }
  if (decoded.typ !== "2fa" || typeof decoded.sub !== "string") {
    throw new UnauthorizedError("Ongeldige 2FA-sessie");
  }
  return decoded.sub;
}

/** Second login step: verify the TOTP code against the challenge and issue tokens. */
export async function loginVerifyTwoFactor(
  challengeToken: string,
  code: string,
): Promise<AuthResult> {
  const userId = verifyChallengeToken(challengeToken);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
    throw new UnauthorizedError("2FA is niet ingeschakeld voor dit account");
  }
  if (!verifyTotp(code, decryptString(user.twoFactorSecret))) {
    throw new UnauthorizedError("Ongeldige verificatiecode");
  }
  const tokens = await issueTokens(user.id, user.email, user.platformRole);
  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      platformRole: user.platformRole,
    },
    ...tokens,
  };
}

async function issueTokens(
  userId: string,
  email: string,
  platformRole: PlatformRole,
): Promise<AuthTokens> {
  const access = signAccessToken(userId, email, platformRole);
  const refresh = generateRefreshToken();
  await prisma.refreshToken.create({
    data: { userId, tokenHash: refresh.hash, expiresAt: refresh.expiresAt },
  });
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt,
    refreshToken: refresh.raw,
  };
}

export async function refresh(rawRefreshToken: string): Promise<AuthTokens> {
  const tokenHash = hashRefreshToken(rawRefreshToken);
  const row = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!row || row.revokedAt || row.expiresAt < new Date()) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  // Rotation: atomically claim the token. updateMany with a revokedAt:null guard
  // ensures only ONE concurrent request wins the rotation — the loser sees
  // count === 0 and is rejected, preventing a single token from minting two pairs.
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count !== 1) {
    throw new UnauthorizedError("Invalid refresh token");
  }

  return issueTokens(row.userId, row.user.email, row.user.platformRole);
}

export async function logout(rawRefreshToken: string | undefined): Promise<void> {
  if (!rawRefreshToken) return;
  const tokenHash = hashRefreshToken(rawRefreshToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/* -------------------------------------------------------------------------- */
/*  Invitation / password-reset tokens + password setting                     */
/* -------------------------------------------------------------------------- */

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Mint a single-use token (returns the RAW value to embed in an email link). */
export async function createUserToken(userId: string, kind: UserTokenKind): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  const tokenHash = hashRefreshToken(raw);
  const ttl = kind === UserTokenKind.INVITE ? INVITE_TTL_MS : RESET_TTL_MS;
  await prisma.userToken.create({
    data: { userId, kind, tokenHash, expiresAt: new Date(Date.now() + ttl) },
  });
  return raw;
}

/** Atomically consume a single-use token of the expected kind; returns the userId. */
async function consumeUserToken(rawToken: string, kind: UserTokenKind): Promise<string> {
  const tokenHash = hashRefreshToken(rawToken);
  const row = await prisma.userToken.findUnique({ where: { tokenHash } });
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt < new Date()) {
    throw new BadRequestError("Ongeldige of verlopen link");
  }
  const claimed = await prisma.userToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count !== 1) throw new BadRequestError("Ongeldige of verlopen link");
  return row.userId;
}

/** Set a user's password and revoke all their refresh tokens (forces re-login). */
export async function setUserPassword(userId: string, password: string): Promise<void> {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

/** Consume an invite/reset token and set the new password in one step. */
export async function completePasswordSetup(
  rawToken: string,
  kind: UserTokenKind,
  password: string,
): Promise<void> {
  const userId = await consumeUserToken(rawToken, kind);
  await setUserPassword(userId, password);
}

export function verifyAccessToken(token: string): {
  sub: string;
  email: string;
  platformRole: PlatformRole;
} {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    if (!decoded.sub || typeof decoded.sub !== "string") throw new Error("Bad token");
    // Default to USER for tokens issued before this claim existed.
    const platformRole =
      decoded.prole === PlatformRole.PLATFORM_ADMIN
        ? PlatformRole.PLATFORM_ADMIN
        : PlatformRole.USER;
    return { sub: decoded.sub, email: String(decoded.email ?? ""), platformRole };
  } catch {
    throw new UnauthorizedError("Invalid or expired access token");
  }
}

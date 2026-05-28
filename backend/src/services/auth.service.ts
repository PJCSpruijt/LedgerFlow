import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";
import { PlatformRole, ScopedRole, ScopeLevel } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { ConflictError, UnauthorizedError } from "../utils/errors.js";

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

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user) throw new UnauthorizedError("Invalid credentials");

  const ok = await bcrypt.compare(input.password, user.passwordHash);
  if (!ok) throw new UnauthorizedError("Invalid credentials");

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

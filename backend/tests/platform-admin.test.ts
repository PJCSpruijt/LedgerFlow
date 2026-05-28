import { describe, it, expect, vi } from "vitest";
import jwt from "jsonwebtoken";
import { PlatformRole } from "@prisma/client";
import { verifyAccessToken } from "../src/services/auth.service.js";
import {
  isPlatformAdmin,
  requirePlatformAdmin,
  requireRole,
} from "../src/middleware/auth.js";
import { requireActiveSubscription } from "../src/middleware/subscription.js";
import { ForbiddenError, SubscriptionRequiredError } from "../src/utils/errors.js";

const SECRET = "test-access-secret-0123456789abcdef";

function sign(payload: Record<string, unknown>): string {
  return jwt.sign(payload, SECRET, { expiresIn: "15m" });
}

describe("verifyAccessToken — platform role claim", () => {
  it("extracts PLATFORM_ADMIN from the prole claim", () => {
    const token = sign({ sub: "u1", email: "a@b.c", prole: PlatformRole.PLATFORM_ADMIN });
    expect(verifyAccessToken(token).platformRole).toBe(PlatformRole.PLATFORM_ADMIN);
  });

  it("defaults to USER when the prole claim is absent (back-compat)", () => {
    const token = sign({ sub: "u1", email: "a@b.c" });
    expect(verifyAccessToken(token).platformRole).toBe(PlatformRole.USER);
  });

  it("defaults to USER when the prole claim is not a known role", () => {
    const token = sign({ sub: "u1", email: "a@b.c", prole: "SUPERHERO" });
    expect(verifyAccessToken(token).platformRole).toBe(PlatformRole.USER);
  });
});

describe("isPlatformAdmin", () => {
  it("is true only for PLATFORM_ADMIN", () => {
    expect(isPlatformAdmin({ user: { id: "1", email: "", platformRole: PlatformRole.PLATFORM_ADMIN } })).toBe(true);
    expect(isPlatformAdmin({ user: { id: "1", email: "", platformRole: PlatformRole.USER } })).toBe(false);
    expect(isPlatformAdmin({})).toBe(false);
  });
});

describe("requirePlatformAdmin", () => {
  it("passes for a platform admin", () => {
    const next = vi.fn();
    requirePlatformAdmin(
      { user: { id: "1", email: "", platformRole: PlatformRole.PLATFORM_ADMIN } } as never,
      {} as never,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects a normal user with ForbiddenError", () => {
    const next = vi.fn();
    requirePlatformAdmin(
      { user: { id: "1", email: "", platformRole: PlatformRole.USER } } as never,
      {} as never,
      next,
    );
    expect(next.mock.calls[0]![0]).toBeInstanceOf(ForbiddenError);
  });
});

describe("requireRole — platform admin bypass", () => {
  it("passes a platform admin even with no organization context", () => {
    const next = vi.fn();
    requireRole("OWNER")(
      { user: { id: "1", email: "", platformRole: PlatformRole.PLATFORM_ADMIN } } as never,
      {} as never,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects a normal user lacking the required role", () => {
    const next = vi.fn();
    requireRole("ADMIN")(
      {
        user: { id: "1", email: "", platformRole: PlatformRole.USER },
        organization: { id: "o1", role: "VIEWER" },
      } as never,
      {} as never,
      next,
    );
    expect(next.mock.calls[0]![0]).toBeInstanceOf(ForbiddenError);
  });
});

describe("requireActiveSubscription — bypass scoping", () => {
  it("lets a platform admin through without a subscription (no DB hit)", async () => {
    const next = vi.fn();
    await requireActiveSubscription(
      { user: { id: "1", email: "", platformRole: PlatformRole.PLATFORM_ADMIN } } as never,
      {} as never,
      next,
    );
    expect(next).toHaveBeenCalledWith();
  });

  it("does NOT bypass for a normal user with no organization context", async () => {
    const next = vi.fn();
    await requireActiveSubscription(
      { user: { id: "1", email: "", platformRole: PlatformRole.USER } } as never,
      {} as never,
      next,
    );
    expect(next.mock.calls[0]![0]).toBeInstanceOf(SubscriptionRequiredError);
  });
});

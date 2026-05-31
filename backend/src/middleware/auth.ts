import type { RequestHandler } from "express";
import { PlatformRole, ScopedRole, ScopeLevel } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { randomUUID } from "node:crypto";
import { verifyAccessToken } from "../services/auth.service.js";
import { requestContext } from "../config/request-context.js";
import {
  ForbiddenError,
  TwoFactorEnrollmentRequiredError,
  UnauthorizedError,
} from "../utils/errors.js";

/** True when the request is made by the platform superuser. */
export function isPlatformAdmin(req: { user?: Express.UserContext }): boolean {
  return req.user?.platformRole === PlatformRole.PLATFORM_ADMIN;
}

/** Require a valid Bearer access token. Populates req.user. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.header("authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return next(new UnauthorizedError("Missing bearer token"));
  }
  const { sub, email, platformRole } = verifyAccessToken(token);
  req.user = { id: sub, email, platformRole };
  // Make the user + a correlation id available to deep layers (API-usage ledger)
  // for the remainder of this request's async chain.
  requestContext.enterWith({ correlationId: randomUUID(), userId: sub, initiatorType: "USER" });
  next();
};

/** Require the caller to be the platform superuser. Use on platform admin routes. */
export const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  if (!isPlatformAdmin(req)) return next(new ForbiddenError("Platform admin only"));
  next();
};

/**
 * Hard-enforce admin-mandated 2FA: if the bearer's user has twoFactorRequired
 * but hasn't enrolled (twoFactorEnabled=false), block the request so the only
 * thing they can do is enroll. Mounted on /api (the 2FA enrollment endpoints
 * live under /auth, so they stay reachable). Requests without a valid bearer are
 * passed through untouched — the route's own requireAuth handles the 401.
 */
export const enforceTwoFactorEnrollment: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.header("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token) return next();
    let userId: string;
    try {
      userId = verifyAccessToken(token).sub;
    } catch {
      return next();
    }
    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { twoFactorRequired: true, twoFactorEnabled: true },
    });
    if (u && u.twoFactorRequired && !u.twoFactorEnabled) {
      return next(new TwoFactorEnrollmentRequiredError());
    }
    next();
  } catch (err) {
    next(err);
  }
};

// Most-privileged first. Used only to pick the single role we surface for display;
// authorization guards check the full `roles` set, not this ordering.
const ROLE_PRIORITY: ScopedRole[] = [
  ScopedRole.WORKSPACE_ADMIN,
  ScopedRole.ACCOUNTANT_ADMIN,
  ScopedRole.CLIENT_ADMIN,
  ScopedRole.CONSOLIDATION_MANAGER,
  ScopedRole.MAPPING_MANAGER,
  ScopedRole.ACCOUNTANT_USER,
  ScopedRole.CLIENT_USER,
  ScopedRole.READ_ONLY,
];

export function topRole(roles: ScopedRole[]): ScopedRole {
  return ROLE_PRIORITY.find((r) => roles.includes(r)) ?? ScopedRole.READ_ONLY;
}

/**
 * Resolve the request's scope from the `x-workspace-id` / `x-group-id` /
 * `x-entity-id` headers (deepest one wins) and the user's memberships, then
 * populate req.scope. Effective access to an entity is granted by a membership
 * on that entity, its parent group, or the workspace.
 *
 * The platform superuser gets implicit WORKSPACE_ADMIN on any scope chain.
 */
export const requireScope: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();

    const workspaceId = (req.header("x-workspace-id") || "").trim();
    const groupHeader = (req.header("x-group-id") || "").trim() || undefined;
    const entityHeader = (req.header("x-entity-id") || "").trim() || undefined;
    if (!workspaceId) throw new ForbiddenError("Missing workspace context");

    // Walk the chain from the deepest provided level and verify the ids actually
    // belong together, so a caller can't pair an entity with a foreign workspace.
    let groupId = groupHeader;
    let entityId = entityHeader;
    let scopeLevel: ScopeLevel = ScopeLevel.WORKSPACE;

    if (entityHeader) {
      const entity = await prisma.entity.findUnique({
        where: { id: entityHeader },
        include: { group: true },
      });
      if (!entity || entity.group.workspaceId !== workspaceId) {
        throw new ForbiddenError("Entity does not belong to this workspace");
      }
      if (groupHeader && groupHeader !== entity.groupId) {
        throw new ForbiddenError("Entity does not belong to this group");
      }
      groupId = entity.groupId;
      entityId = entity.id;
      scopeLevel = ScopeLevel.ENTITY;
    } else if (groupHeader) {
      const group = await prisma.group.findUnique({ where: { id: groupHeader } });
      if (!group || group.workspaceId !== workspaceId) {
        throw new ForbiddenError("Group does not belong to this workspace");
      }
      groupId = group.id;
      scopeLevel = ScopeLevel.GROUP;
    }

    if (isPlatformAdmin(req)) {
      req.scope = {
        workspaceId,
        groupId,
        entityId,
        scopeLevel,
        role: ScopedRole.WORKSPACE_ADMIN,
        roles: [ScopedRole.WORKSPACE_ADMIN],
      };
      return next();
    }

    const memberships = await prisma.membership.findMany({
      where: {
        userId: req.user.id,
        OR: [
          { workspaceId },
          ...(groupId ? [{ groupId }] : []),
          ...(entityId ? [{ entityId }] : []),
        ],
      },
      select: { role: true },
    });
    if (memberships.length === 0) {
      throw new ForbiddenError("No access to this scope");
    }
    const roles = [...new Set(memberships.map((m) => m.role))];

    req.scope = { workspaceId, groupId, entityId, scopeLevel, role: topRole(roles), roles };
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Require the request's effective scope to include at least one of `allowed`.
 * Must run after requireScope. The platform superuser always passes.
 */
export function requireScopeRole(...allowed: ScopedRole[]): RequestHandler {
  return (req, _res, next) => {
    if (isPlatformAdmin(req)) return next();
    if (!req.scope) return next(new ForbiddenError("No scope context"));
    if (!req.scope.roles.some((r) => allowed.includes(r))) {
      return next(new ForbiddenError(`Requires one of: ${allowed.join(", ")}`));
    }
    next();
  };
}

// Common role groupings, so route declarations stay readable.
export const SCOPE_ADMIN_ROLES: ScopedRole[] = [
  ScopedRole.WORKSPACE_ADMIN,
  ScopedRole.ACCOUNTANT_ADMIN,
  ScopedRole.CLIENT_ADMIN,
];

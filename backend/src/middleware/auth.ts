import type { RequestHandler } from "express";
import { OrganizationRole, PlatformRole } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { verifyAccessToken } from "../services/auth.service.js";
import { ForbiddenError, UnauthorizedError } from "../utils/errors.js";

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
  next();
};

/** Require the caller to be the platform superuser. Use on platform admin routes. */
export const requirePlatformAdmin: RequestHandler = (req, _res, next) => {
  if (!isPlatformAdmin(req)) return next(new ForbiddenError("Platform admin only"));
  next();
};

/**
 * Require the request to be scoped to an organization the user belongs to.
 * Organization id is taken from header `x-organization-id` or query.organizationId.
 * Populates req.organization.
 */
export const requireOrganization: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.user) throw new UnauthorizedError();
    const orgId =
      (req.header("x-organization-id") || (req.query.organizationId as string | undefined) || "")
        .trim();
    if (!orgId) throw new ForbiddenError("Missing organization context");

    // Platform superuser has implicit OWNER-level access to every organization,
    // without requiring a membership row.
    if (isPlatformAdmin(req)) {
      req.organization = { id: orgId, role: OrganizationRole.OWNER };
      return next();
    }

    const membership = await prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId: req.user.id, organizationId: orgId } },
    });
    if (!membership) throw new ForbiddenError("Not a member of this organization");

    req.organization = { id: orgId, role: membership.role };
    next();
  } catch (err) {
    next(err);
  }
};

const ROLE_RANK: Record<OrganizationRole, number> = {
  VIEWER: 0,
  MEMBER: 1,
  ADMIN: 2,
  OWNER: 3,
};

/** Require the caller's role within the organization to be at least `minRole`. */
export function requireRole(minRole: OrganizationRole): RequestHandler {
  return (req, _res, next) => {
    if (isPlatformAdmin(req)) return next();
    if (!req.organization) return next(new ForbiddenError("No organization context"));
    if (ROLE_RANK[req.organization.role] < ROLE_RANK[minRole]) {
      return next(new ForbiddenError(`Requires role ${minRole}+`));
    }
    next();
  };
}

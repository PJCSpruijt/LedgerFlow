import { Router } from "express";
import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.js";

export const adminRouter = Router();

// Every admin route is platform-superuser only and platform-wide (no scope
// headers). These endpoints expose read-only overviews; they MUST never return
// secrets (password hashes, encrypted connector credentials).
adminRouter.use(requireAuth, requirePlatformAdmin);

/** All registered users with a membership count. */
adminRouter.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        platformRole: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
    });
    res.json({
      users: users.map((u) => ({
        id: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        platformRole: u.platformRole,
        createdAt: u.createdAt,
        membershipCount: u._count.memberships,
      })),
    });
  }),
);

/** All workspaces with subscription, member count, and the group/entity tree. */
adminRouter.get(
  "/workspaces",
  asyncHandler(async (_req, res) => {
    const workspaces = await prisma.workspace.findMany({
      orderBy: { createdAt: "asc" },
      include: {
        subscription: true,
        _count: { select: { memberships: true } },
        groups: {
          orderBy: { createdAt: "asc" },
          include: {
            _count: { select: { entities: true } },
            entities: {
              orderBy: { createdAt: "asc" },
              include: {
                yukiConnection: {
                  select: { id: true, environment: true, lastTestedAt: true, lastSyncAt: true },
                },
              },
            },
          },
        },
      },
    });

    res.json({
      workspaces: workspaces.map((ws) => ({
        id: ws.id,
        name: ws.name,
        type: ws.type,
        createdAt: ws.createdAt,
        memberCount: ws._count.memberships,
        subscription: ws.subscription
          ? { plan: ws.subscription.plan, status: ws.subscription.status, validUntil: ws.subscription.validUntil }
          : null,
        groups: ws.groups.map((g) => ({
          id: g.id,
          name: g.name,
          entities: g.entities.map((e) => ({
            id: e.id,
            name: e.name,
            yuki: e.yukiConnection
              ? {
                  environment: e.yukiConnection.environment,
                  lastTestedAt: e.yukiConnection.lastTestedAt,
                  lastSyncAt: e.yukiConnection.lastSyncAt,
                }
              : null,
          })),
        })),
      })),
    });
  }),
);

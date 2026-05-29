import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import {
  BillingInterval,
  PlatformRole,
  ScopedRole,
  ScopeLevel,
  SubscriptionPlan,
  SubscriptionStatus,
  UserTokenKind,
  WorkspaceType,
} from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.js";
import { MODULES, isModuleKey } from "../config/modules.js";
import { createUserToken } from "../services/auth.service.js";
import {
  isEmailConfigured,
  sendInvitationEmail,
  sendPasswordResetEmail,
} from "../services/email.service.js";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../utils/errors.js";

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
        twoFactorEnabled: true,
        twoFactorRequired: true,
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
        twoFactorEnabled: u.twoFactorEnabled,
        twoFactorRequired: u.twoFactorRequired,
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
        subscription: { include: { planRef: true } },
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
          ? {
              status: ws.subscription.status,
              validUntil: ws.subscription.validUntil,
              planId: ws.subscription.planId,
              planKey: ws.subscription.planRef?.key ?? ws.subscription.plan ?? null,
              planName: ws.subscription.planRef?.name ?? ws.subscription.plan ?? null,
            }
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

/** Manually create a workspace (with a first group + administration), optionally
 * assigning an owner who becomes WORKSPACE_ADMIN. Platform admins always see all
 * workspaces, so an owner is optional. */
const WorkspaceCreateSchema = z.object({
  name: z.string().min(1).max(120),
  type: z.nativeEnum(WorkspaceType).default(WorkspaceType.COMPANY),
  groupName: z.string().min(1).max(120).optional(),
  entityName: z.string().min(1).max(120).optional(),
  ownerUserId: z.string().uuid().optional(),
});

adminRouter.post(
  "/workspaces",
  validateBody(WorkspaceCreateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof WorkspaceCreateSchema>;

    const workspace = await prisma.$transaction(async (tx) => {
      if (body.ownerUserId) {
        const owner = await tx.user.findUnique({ where: { id: body.ownerUserId } });
        if (!owner) throw new BadRequestError("Onbekende eigenaar");
      }
      const created = await tx.workspace.create({
        data: {
          name: body.name,
          type: body.type,
          groups: {
            create: {
              name: body.groupName?.trim() || body.name,
              entities: { create: { name: body.entityName?.trim() || body.name } },
            },
          },
        },
        include: { groups: { include: { entities: true } } },
      });
      await tx.subscription.create({ data: { workspaceId: created.id, status: "NONE" } });
      if (body.ownerUserId) {
        await tx.membership.create({
          data: {
            userId: body.ownerUserId,
            scopeLevel: ScopeLevel.WORKSPACE,
            role: ScopedRole.WORKSPACE_ADMIN,
            workspaceId: created.id,
          },
        });
      }
      await tx.auditLog.create({
        data: {
          workspaceId: created.id,
          userId: req.user!.id,
          action: "admin.workspace.created",
          metadata: { ownerUserId: body.ownerUserId ?? null, type: body.type },
        },
      });
      return created;
    });

    res.status(201).json({
      workspace: {
        id: workspace.id,
        name: workspace.name,
        type: workspace.type,
        groups: workspace.groups.map((g) => ({
          id: g.id,
          name: g.name,
          entities: g.entities.map((e) => ({ id: e.id, name: e.name })),
        })),
      },
    });
  }),
);

/* -------------------------------------------------------------------------- */
/*  Plan catalog                                                              */
/* -------------------------------------------------------------------------- */

/** The code-defined module catalog plans can grant. */
adminRouter.get(
  "/modules",
  asyncHandler(async (_req, res) => {
    res.json({ modules: MODULES });
  }),
);

const moduleArray = z
  .array(z.string())
  .refine((arr) => arr.every(isModuleKey), { message: "Onbekende module-key" });

const PlanCreateSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Z0-9_]+$/, "Key mag alleen hoofdletters, cijfers en _ bevatten"),
  name: z.string().min(1).max(80),
  description: z.string().max(500).nullish(),
  priceCents: z.number().int().min(0),
  currency: z.string().length(3).default("EUR"),
  interval: z.nativeEnum(BillingInterval).default(BillingInterval.MONTH),
  modules: moduleArray.default([]),
  stripePriceId: z.string().max(120).nullish(),
  active: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});

// Update: every field optional, key is immutable (not accepted).
const PlanUpdateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullish(),
  priceCents: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  interval: z.nativeEnum(BillingInterval).optional(),
  modules: moduleArray.optional(),
  stripePriceId: z.string().max(120).nullish(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

const IdParam = z.object({ id: z.string().uuid() });

function serializePlan(p: {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: BillingInterval;
  modules: string[];
  stripePriceId: string | null;
  active: boolean;
  sortOrder: number;
  _count?: { subscriptions: number };
}) {
  return {
    id: p.id,
    key: p.key,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    currency: p.currency,
    interval: p.interval,
    modules: p.modules,
    stripePriceId: p.stripePriceId,
    active: p.active,
    sortOrder: p.sortOrder,
    subscriberCount: p._count?.subscriptions ?? 0,
  };
}

/** List every plan (active and inactive) with subscriber counts. */
adminRouter.get(
  "/plans",
  asyncHandler(async (_req, res) => {
    const plans = await prisma.plan.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: { _count: { select: { subscriptions: true } } },
    });
    res.json({ plans: plans.map(serializePlan) });
  }),
);

adminRouter.post(
  "/plans",
  validateBody(PlanCreateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof PlanCreateSchema>;
    const existing = await prisma.plan.findUnique({ where: { key: body.key } });
    if (existing) throw new BadRequestError(`Er bestaat al een plan met key "${body.key}"`);
    const plan = await prisma.plan.create({
      data: {
        key: body.key,
        name: body.name,
        description: body.description ?? null,
        priceCents: body.priceCents,
        currency: body.currency,
        interval: body.interval,
        modules: body.modules,
        stripePriceId: body.stripePriceId ?? null,
        active: body.active,
        sortOrder: body.sortOrder,
      },
      include: { _count: { select: { subscriptions: true } } },
    });
    res.status(201).json({ plan: serializePlan(plan) });
  }),
);

adminRouter.patch(
  "/plans/:id",
  validateParams(IdParam),
  validateBody(PlanUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof IdParam>;
    const body = req.body as z.infer<typeof PlanUpdateSchema>;
    const existing = await prisma.plan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundError("Plan niet gevonden");
    const plan = await prisma.plan.update({
      where: { id },
      data: {
        name: body.name,
        description: body.description === undefined ? undefined : body.description,
        priceCents: body.priceCents,
        currency: body.currency,
        interval: body.interval,
        modules: body.modules,
        stripePriceId: body.stripePriceId === undefined ? undefined : body.stripePriceId,
        active: body.active,
        sortOrder: body.sortOrder,
      },
      include: { _count: { select: { subscriptions: true } } },
    });
    res.json({ plan: serializePlan(plan) });
  }),
);

adminRouter.delete(
  "/plans/:id",
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof IdParam>;
    const existing = await prisma.plan.findUnique({
      where: { id },
      include: { _count: { select: { subscriptions: true } } },
    });
    if (!existing) throw new NotFoundError("Plan niet gevonden");
    if (existing._count.subscriptions > 0) {
      throw new BadRequestError(
        `Dit plan is gekoppeld aan ${existing._count.subscriptions} abonnement(en). Wijs die eerst een ander plan toe of zet het plan op inactief.`,
      );
    }
    await prisma.plan.delete({ where: { id } });
    res.status(204).end();
  }),
);

/* -------------------------------------------------------------------------- */
/*  Manual per-workspace subscription assignment (no Stripe)                  */
/* -------------------------------------------------------------------------- */

const SubscriptionAssignSchema = z.object({
  planId: z.string().uuid().nullable().optional(),
  status: z.nativeEnum(SubscriptionStatus).optional(),
  validUntil: z.union([z.coerce.date(), z.null()]).optional(),
});

const WorkspaceIdParam = z.object({ workspaceId: z.string().uuid() });

adminRouter.patch(
  "/workspaces/:workspaceId/subscription",
  validateParams(WorkspaceIdParam),
  validateBody(SubscriptionAssignSchema),
  asyncHandler(async (req, res) => {
    const { workspaceId } = req.params as z.infer<typeof WorkspaceIdParam>;
    const body = req.body as z.infer<typeof SubscriptionAssignSchema>;

    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) throw new NotFoundError("Werkruimte niet gevonden");

    // Resolve the target plan (if changing) so we can mirror the legacy enum,
    // which keeps the Stripe price mapping and older displays consistent.
    let planEnum: SubscriptionPlan | null | undefined;
    if (body.planId !== undefined) {
      if (body.planId === null) {
        planEnum = null;
      } else {
        const plan = await prisma.plan.findUnique({ where: { id: body.planId } });
        if (!plan) throw new BadRequestError("Onbekend plan");
        planEnum =
          plan.key in SubscriptionPlan
            ? SubscriptionPlan[plan.key as keyof typeof SubscriptionPlan]
            : null;
      }
    }

    const data: {
      planId?: string | null;
      plan?: SubscriptionPlan | null;
      status?: SubscriptionStatus;
      validUntil?: Date | null;
    } = {};
    if (body.planId !== undefined) {
      data.planId = body.planId;
      data.plan = planEnum;
    }
    if (body.status !== undefined) data.status = body.status;
    if (body.validUntil !== undefined) data.validUntil = body.validUntil;

    const sub = await prisma.subscription.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        planId: data.planId ?? null,
        plan: data.plan ?? null,
        status: data.status ?? SubscriptionStatus.NONE,
        validUntil: data.validUntil ?? null,
      },
      update: data,
      include: { planRef: true },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId,
        userId: req.user!.id,
        action: "admin.subscription.assigned",
        metadata: {
          planId: sub.planId,
          planKey: sub.planRef?.key ?? null,
          status: sub.status,
          validUntil: sub.validUntil,
        },
      },
    });

    res.json({
      subscription: {
        status: sub.status,
        validUntil: sub.validUntil,
        planId: sub.planId,
        planKey: sub.planRef?.key ?? sub.plan ?? null,
        planName: sub.planRef?.name ?? sub.plan ?? null,
      },
    });
  }),
);

/* -------------------------------------------------------------------------- */
/*  User management                                                          */
/* -------------------------------------------------------------------------- */

function inviteLink(rawToken: string): string {
  return `${env.APP_BASE_URL}/accept-invitation?token=${rawToken}`;
}
function resetLink(rawToken: string): string {
  return `${env.APP_BASE_URL}/reset-password?token=${rawToken}`;
}

/**
 * Guard against locking everyone out of the platform: there must always be at
 * least one PLATFORM_ADMIN. Throws if `userId` is the last admin (used before a
 * role downgrade or deletion).
 */
async function assertNotLastPlatformAdmin(userId: string): Promise<void> {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { platformRole: true } });
  if (target?.platformRole !== PlatformRole.PLATFORM_ADMIN) return;
  const adminCount = await prisma.user.count({ where: { platformRole: PlatformRole.PLATFORM_ADMIN } });
  if (adminCount <= 1) {
    throw new BadRequestError("Dit is de laatste platformbeheerder; die kan niet verwijderd of gedegradeerd worden.");
  }
}

const UserCreateSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  platformRole: z.nativeEnum(PlatformRole).default(PlatformRole.USER),
});

const UserUpdateSchema = z.object({
  email: z.string().email().optional(),
  firstName: z.string().min(1).max(80).optional(),
  lastName: z.string().min(1).max(80).optional(),
  platformRole: z.nativeEnum(PlatformRole).optional(),
});

const UserIdParam = z.object({ id: z.string().uuid() });

/** Create a user and email them an invitation to set their password. */
adminRouter.post(
  "/users",
  validateBody(UserCreateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof UserCreateSchema>;
    const email = body.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictError("Er bestaat al een gebruiker met dit e-mailadres");

    // Unusable random password until the invite is accepted.
    const passwordHash = await bcrypt.hash(randomBytes(32).toString("base64url"), 12);
    const user = await prisma.user.create({
      data: {
        email,
        firstName: body.firstName,
        lastName: body.lastName,
        platformRole: body.platformRole,
        passwordHash,
      },
      select: { id: true, email: true, firstName: true, lastName: true, platformRole: true, createdAt: true },
    });

    const rawToken = await createUserToken(user.id, UserTokenKind.INVITE);
    const link = inviteLink(rawToken);
    const sent = await sendInvitationEmail({ to: user.email, firstName: user.firstName, link });

    res.status(201).json({
      user: { ...user, membershipCount: 0, twoFactorEnabled: false, twoFactorRequired: false },
      emailDelivered: sent.delivered,
      // Surface the link only when email couldn't be sent (dev / unconfigured SMTP).
      inviteUrl: sent.delivered ? undefined : link,
    });
  }),
);

/** Edit a user's name, email, or platform role. */
adminRouter.patch(
  "/users/:id",
  validateParams(UserIdParam),
  validateBody(UserUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof UserIdParam>;
    const body = req.body as z.infer<typeof UserUpdateSchema>;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError("Gebruiker niet gevonden");

    // Demoting the last platform admin would lock everyone out.
    if (body.platformRole && body.platformRole !== PlatformRole.PLATFORM_ADMIN) {
      await assertNotLastPlatformAdmin(id);
    }
    if (body.email) {
      const lower = body.email.toLowerCase();
      const clash = await prisma.user.findUnique({ where: { email: lower } });
      if (clash && clash.id !== id) throw new ConflictError("E-mailadres al in gebruik");
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        email: body.email?.toLowerCase(),
        firstName: body.firstName,
        lastName: body.lastName,
        platformRole: body.platformRole,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        platformRole: true,
        twoFactorEnabled: true,
        twoFactorRequired: true,
        createdAt: true,
        _count: { select: { memberships: true } },
      },
    });
    res.json({
      user: {
        id: updated.id,
        email: updated.email,
        firstName: updated.firstName,
        lastName: updated.lastName,
        platformRole: updated.platformRole,
        twoFactorEnabled: updated.twoFactorEnabled,
        twoFactorRequired: updated.twoFactorRequired,
        createdAt: updated.createdAt,
        membershipCount: updated._count.memberships,
      },
    });
  }),
);

/** Delete a user (cannot delete yourself or the last platform admin). */
adminRouter.delete(
  "/users/:id",
  validateParams(UserIdParam),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof UserIdParam>;
    if (id === req.user!.id) throw new ForbiddenError("Je kunt je eigen account niet verwijderen");
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError("Gebruiker niet gevonden");
    await assertNotLastPlatformAdmin(id);
    await prisma.user.delete({ where: { id } });
    res.status(204).end();
  }),
);

/** Send a password-reset email (admin-initiated). */
adminRouter.post(
  "/users/:id/reset-password",
  validateParams(UserIdParam),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof UserIdParam>;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError("Gebruiker niet gevonden");
    const rawToken = await createUserToken(user.id, UserTokenKind.PASSWORD_RESET);
    const link = resetLink(rawToken);
    const sent = await sendPasswordResetEmail({ to: user.email, firstName: user.firstName, link });
    res.json({ emailDelivered: sent.delivered, resetUrl: sent.delivered ? undefined : link });
  }),
);

/** Require or disable 2FA for a user. */
const TwoFactorAdminSchema = z.object({
  action: z.enum(["require", "unrequire", "disable"]),
});

adminRouter.post(
  "/users/:id/2fa",
  validateParams(UserIdParam),
  validateBody(TwoFactorAdminSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof UserIdParam>;
    const { action } = req.body as z.infer<typeof TwoFactorAdminSchema>;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError("Gebruiker niet gevonden");

    const data =
      action === "require"
        ? { twoFactorRequired: true }
        : action === "unrequire"
          ? { twoFactorRequired: false }
          : // "disable": fully clear enrollment.
            { twoFactorRequired: false, twoFactorEnabled: false, twoFactorSecret: null };

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, twoFactorEnabled: true, twoFactorRequired: true },
    });

    // AuditLog is workspace-scoped; attach to the target's (or actor's) first
    // workspace if one exists, otherwise skip — there's no platform-level log.
    const wsId = (await firstWorkspaceId(id)) ?? (await firstWorkspaceId(req.user!.id));
    if (wsId) {
      await prisma.auditLog.create({
        data: {
          workspaceId: wsId,
          userId: req.user!.id,
          action: `admin.user.2fa.${action}`,
          metadata: { targetUserId: id },
        },
      });
    }

    res.json({ user: updated });
  }),
);

async function firstWorkspaceId(userId: string): Promise<string | null> {
  const m = await prisma.membership.findFirst({
    where: { userId, workspaceId: { not: null } },
    select: { workspaceId: true },
  });
  return m?.workspaceId ?? null;
}

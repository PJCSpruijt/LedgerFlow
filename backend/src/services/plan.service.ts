import type { Plan } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { isSubscriptionActive } from "./subscription.service.js";
import { PlanLimitError } from "../utils/errors.js";

/**
 * What a workspace is currently entitled to: whether its subscription is active
 * and which feature modules its plan grants. Resolution prefers the explicit
 * `planId` link and falls back to the legacy `plan` enum (matched by key) so
 * both Stripe- and manually-activated subscriptions resolve to the same plan.
 */
export interface PlanLimits {
  maxAdministrations: number | null;
  maxUsers: number | null;
  maxApiKeys: number | null;
}
export interface Entitlements {
  active: boolean;
  planKey: string | null;
  planName: string | null;
  modules: string[];
  limits: PlanLimits;
}
export type LimitedResource = "administrations" | "users" | "apiKeys";

/** Resolve the managed Plan for a subscription, via planId then legacy enum key. */
export async function resolvePlan(sub: {
  planId: string | null;
  plan: string | null;
  planRef?: Plan | null;
} | null): Promise<Plan | null> {
  if (!sub) return null;
  if (sub.planRef) return sub.planRef;
  if (sub.planId) return prisma.plan.findUnique({ where: { id: sub.planId } });
  if (sub.plan) return prisma.plan.findUnique({ where: { key: sub.plan } });
  return null;
}

export async function getWorkspaceEntitlements(workspaceId: string): Promise<Entitlements> {
  const sub = await prisma.subscription.findUnique({
    where: { workspaceId },
    include: { planRef: true },
  });
  const active = isSubscriptionActive(sub);
  const plan = await resolvePlan(sub);
  return {
    active,
    planKey: plan?.key ?? sub?.plan ?? null,
    planName: plan?.name ?? null,
    modules: plan?.modules ?? [],
    limits: {
      maxAdministrations: plan?.maxAdministrations ?? null,
      maxUsers: plan?.maxUsers ?? null,
      maxApiKeys: plan?.maxApiKeys ?? null,
    },
  };
}

/** True when the workspace's subscription is active AND its plan grants `moduleKey`. */
export function hasModule(ent: Entitlements, moduleKey: string): boolean {
  return ent.active && ent.modules.includes(moduleKey);
}

export interface WorkspaceUsage {
  administrations: number;
  users: number;
  apiKeys: number;
}

/** Current consumption of the limited resources for a workspace. */
export async function getWorkspaceUsage(workspaceId: string): Promise<WorkspaceUsage> {
  const [administrations, memberships, apiKeys] = await Promise.all([
    prisma.entity.count({ where: { group: { workspaceId } } }),
    prisma.membership.findMany({
      where: { OR: [{ workspaceId }, { group: { workspaceId } }, { entity: { group: { workspaceId } } }] },
      select: { userId: true },
    }),
    prisma.apiKey.count({ where: { workspaceId, revokedAt: null } }),
  ]);
  return { administrations, users: new Set(memberships.map((m) => m.userId)).size, apiKeys };
}

const LIMIT_KEY: Record<LimitedResource, keyof PlanLimits> = {
  administrations: "maxAdministrations",
  users: "maxUsers",
  apiKeys: "maxApiKeys",
};

/**
 * Enforce a per-plan quantity limit before adding a resource. Throws
 * PlanLimitError when the current usage would exceed the plan's cap. No active
 * plan = no extra cap here (subscription gating is handled separately); null
 * limit = unlimited.
 */
export async function assertWithinLimit(workspaceId: string, resource: LimitedResource): Promise<void> {
  const ent = await getWorkspaceEntitlements(workspaceId);
  const limit = ent.limits[LIMIT_KEY[resource]];
  if (limit == null) return; // unlimited
  const usage = await getWorkspaceUsage(workspaceId);
  const used = usage[resource];
  if (used >= limit) throw new PlanLimitError(resource, limit, used);
}

/** Entitlements + current usage, for the billing/licensing UI. */
export async function getLicenseStatus(workspaceId: string): Promise<{ entitlements: Entitlements; usage: WorkspaceUsage }> {
  const [entitlements, usage] = await Promise.all([getWorkspaceEntitlements(workspaceId), getWorkspaceUsage(workspaceId)]);
  return { entitlements, usage };
}

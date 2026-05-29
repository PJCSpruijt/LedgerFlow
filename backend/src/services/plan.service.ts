import type { Plan } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { isSubscriptionActive } from "./subscription.service.js";

/**
 * What a workspace is currently entitled to: whether its subscription is active
 * and which feature modules its plan grants. Resolution prefers the explicit
 * `planId` link and falls back to the legacy `plan` enum (matched by key) so
 * both Stripe- and manually-activated subscriptions resolve to the same plan.
 */
export interface Entitlements {
  active: boolean;
  planKey: string | null;
  modules: string[];
}

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
    modules: plan?.modules ?? [],
  };
}

/** True when the workspace's subscription is active AND its plan grants `moduleKey`. */
export function hasModule(ent: Entitlements, moduleKey: string): boolean {
  return ent.active && ent.modules.includes(moduleKey);
}

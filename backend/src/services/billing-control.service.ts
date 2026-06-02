import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { stripe, STRIPE_PRICE_IDS } from "../config/stripe.js";
import { logger } from "../config/logger.js";
import { getWorkspaceUsage } from "./plan.service.js";
import { BadRequestError, NotFoundError } from "../utils/errors.js";

/**
 * In-app billing control (#34): change a workspace's plan and keep the Stripe
 * line-item quantity in sync with quantity-priced plans — all from within
 * FIN//HUB. Stripe paths are guarded: when Stripe isn't live (placeholder keys)
 * the plan change falls back to a direct (manual) assignment and quantity sync
 * is a no-op.
 */

/** Stripe is usable only with a real secret key (dev uses a placeholder). */
export const stripeReady = (): boolean => !env.STRIPE_SECRET_KEY.includes("placeholder");

function resolvePriceId(planKey: string, catalogPriceId: string | null): string | null {
  if (catalogPriceId && catalogPriceId.trim()) return catalogPriceId.trim();
  const envPrice = (STRIPE_PRICE_IDS as Record<string, string | undefined>)[planKey];
  if (envPrice && !envPrice.endsWith("_placeholder")) return envPrice;
  return null;
}

/** Billable quantity for a plan's unit (1 for flat-priced plans). */
export async function billableQuantity(workspaceId: string, billingUnit: string | null): Promise<number> {
  if (!billingUnit) return 1;
  const usage = await getWorkspaceUsage(workspaceId);
  if (billingUnit === "ADMINISTRATION") return Math.max(1, usage.administrations);
  if (billingUnit === "USER") return Math.max(1, usage.users);
  return 1;
}

export interface ChangePlanResult {
  mode: "stripe" | "manual";
  planKey: string;
  quantity: number;
}

/**
 * Change the plan for a workspace. A live Stripe subscription gets a price swap
 * on its existing item WITH proration (no new checkout); otherwise the plan is
 * assigned directly (manual / unmanaged subscription).
 */
export async function changePlan(input: { workspaceId: string; planKey: string }): Promise<ChangePlanResult> {
  const plan = await prisma.plan.findUnique({ where: { key: input.planKey } });
  if (!plan || !plan.active) throw new BadRequestError("Onbekend of inactief plan");
  const sub = await prisma.subscription.findUnique({ where: { workspaceId: input.workspaceId } });
  if (!sub) throw new NotFoundError("Geen abonnement voor deze werkruimte");
  const quantity = await billableQuantity(input.workspaceId, plan.billingUnit);

  if (sub.stripeSubscriptionId && stripeReady()) {
    const priceId = resolvePriceId(plan.key, plan.stripePriceId);
    if (!priceId) throw new BadRequestError(`Geen Stripe price-ID geconfigureerd voor plan ${plan.key}.`);
    const live = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const item = live.items.data[0];
    if (!item) throw new BadRequestError("Stripe-abonnement heeft geen line-item");
    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{ id: item.id, price: priceId, quantity }],
      proration_behavior: "create_prorations",
      cancel_at_period_end: false,
    });
    // The webhook reconciles status/period; reflect the new plan immediately.
    await prisma.subscription.update({ where: { workspaceId: input.workspaceId }, data: { planId: plan.id } });
    return { mode: "stripe", planKey: plan.key, quantity };
  }

  // No live Stripe subscription → assign the plan directly (active).
  await prisma.subscription.update({
    where: { workspaceId: input.workspaceId },
    data: { planId: plan.id, status: "ACTIVE", cancelAtPeriodEnd: false },
  });
  return { mode: "manual", planKey: plan.key, quantity };
}

/**
 * Push the current billable quantity to the workspace's Stripe subscription item
 * (quantity-priced plans only). Best-effort, fire-and-forget; no-op without Stripe.
 */
export async function syncSubscriptionQuantity(workspaceId: string): Promise<void> {
  if (!stripeReady()) return;
  try {
    const sub = await prisma.subscription.findUnique({ where: { workspaceId }, include: { planRef: true } });
    if (!sub?.stripeSubscriptionId || !sub.planRef?.billingUnit) return;
    const quantity = await billableQuantity(workspaceId, sub.planRef.billingUnit);
    const live = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const item = live.items.data[0];
    if (!item || item.quantity === quantity) return;
    await stripe.subscriptionItems.update(item.id, { quantity, proration_behavior: "create_prorations" });
    logger.info({ workspaceId, quantity }, "Synced Stripe subscription quantity");
  } catch (e) {
    logger.warn({ workspaceId, err: e instanceof Error ? e.message : String(e) }, "Stripe quantity sync failed");
  }
}

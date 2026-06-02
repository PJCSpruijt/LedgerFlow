import express, { Router } from "express";
import { z } from "zod";
import { ScopedRole, SubscriptionPlan } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { stripe, STRIPE_PRICE_IDS, planFromPriceId } from "../config/stripe.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { requireAuth, requireScope, requireScopeRole } from "../middleware/auth.js";
import { mapStripeStatus } from "../services/subscription.service.js";
import { getLicenseStatus } from "../services/plan.service.js";
import { moduleLabels } from "../config/modules.js";
import { BadRequestError, NotFoundError } from "../utils/errors.js";

export const billingRouter = Router();

/* -------------------------------------------------------------------------- */
/*  Checkout                                                                  */
/* -------------------------------------------------------------------------- */

// Accept any plan key from the managed catalog (not just the legacy enum).
const CheckoutSchema = z.object({
  plan: z.string().min(1),
});

/** Resolve the Stripe price-id for a plan: the catalog's stripePriceId wins, with
 * the STRIPE_PRICE_<KEY> env var as fallback (ignoring unconfigured placeholders). */
function resolvePriceId(planKey: string, catalogPriceId: string | null): string | null {
  if (catalogPriceId && catalogPriceId.trim()) return catalogPriceId.trim();
  const envPrice = (STRIPE_PRICE_IDS as Record<string, string | undefined>)[planKey];
  if (envPrice && !envPrice.endsWith("_placeholder")) return envPrice;
  return null;
}

billingRouter.post(
  "/create-checkout-session",
  requireAuth,
  requireScope,
  requireScopeRole(ScopedRole.WORKSPACE_ADMIN),
  validateBody(CheckoutSchema),
  asyncHandler(async (req, res) => {
    const workspaceId = req.scope!.workspaceId;
    const planKey = req.body.plan as string;

    const planRow = await prisma.plan.findUnique({ where: { key: planKey } });
    if (!planRow || !planRow.active) throw new BadRequestError("Onbekend of inactief plan");

    const priceId = resolvePriceId(planKey, planRow.stripePriceId);
    if (!priceId) {
      throw new BadRequestError(
        `Geen Stripe price-ID geconfigureerd voor plan ${planKey}. Stel die in op de Abonnementen-pagina.`,
      );
    }

    const sub = await prisma.subscription.findUnique({ where: { workspaceId } });
    if (!sub) throw new NotFoundError("Subscription record missing");

    // Reuse the customer if we have one, otherwise let Stripe create it on checkout.
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${env.STRIPE_SUCCESS_URL}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: env.STRIPE_CANCEL_URL,
      customer: sub.stripeCustomerId ?? undefined,
      customer_email: sub.stripeCustomerId ? undefined : req.user!.email,
      client_reference_id: workspaceId,
      metadata: { workspaceId, plan: planKey },
      subscription_data: { metadata: { workspaceId } },
    });

    res.json({ url: session.url, sessionId: session.id });
  }),
);

/**
 * The publicly-offered plan catalog (active plans only), for the Billing page.
 * `features` are the human labels of the plan's modules; `checkoutAvailable`
 * marks plans that can be purchased through Stripe (the seeded enum plans).
 */
billingRouter.get(
  "/plans",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const plans = await prisma.plan.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
    res.json({
      plans: plans.map((p) => ({
        key: p.key,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        currency: p.currency,
        interval: p.interval,
        modules: p.modules,
        features: moduleLabels(p.modules),
        checkoutAvailable: p.key in SubscriptionPlan,
      })),
    });
  }),
);

/** Return the current subscription status for the active workspace. */
billingRouter.get(
  "/subscription",
  requireAuth,
  requireScope,
  asyncHandler(async (req, res) => {
    const sub = await prisma.subscription.findUnique({
      where: { workspaceId: req.scope!.workspaceId },
      include: { planRef: true },
    });
    res.json({
      subscription: sub
        ? {
            plan: sub.plan,
            planKey: sub.planRef?.key ?? sub.plan ?? null,
            planName: sub.planRef?.name ?? sub.plan ?? null,
            modules: sub.planRef?.modules ?? [],
            status: sub.status,
            validUntil: sub.validUntil,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            // Cancellable from the app only when it's a real Stripe subscription.
            stripeManaged: !!sub.stripeSubscriptionId,
          }
        : null,
    });
  }),
);

/** Licensing status: entitlements (plan, modules, limits) + current usage. */
billingRouter.get(
  "/license",
  requireAuth,
  requireScope,
  asyncHandler(async (req, res) => {
    res.json(await getLicenseStatus(req.scope!.workspaceId));
  }),
);

/**
 * Cancel the active subscription from within FIN//HUB. We push the cancellation
 * to Stripe (cancel_at_period_end) so the incasso stops; access continues until
 * the paid period ends, after which the webhook flips the status. Admin only.
 */
billingRouter.post(
  "/cancel",
  requireAuth,
  requireScope,
  requireScopeRole(ScopedRole.WORKSPACE_ADMIN),
  asyncHandler(async (req, res) => {
    const workspaceId = req.scope!.workspaceId;
    const sub = await prisma.subscription.findUnique({ where: { workspaceId } });
    if (!sub?.stripeSubscriptionId) {
      throw new BadRequestError("Geen actief Stripe-abonnement om op te zeggen");
    }
    const updated = await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
    await prisma.subscription.update({
      where: { workspaceId },
      data: { cancelAtPeriodEnd: true },
    });
    await prisma.auditLog.create({
      data: { workspaceId, userId: req.user!.id, action: "subscription.cancel_requested", metadata: {} },
    });
    res.json({ cancelAtPeriodEnd: true, validUntil: sub.validUntil, stripeStatus: updated.status });
  }),
);

/** Re-sync the local subscription status from Stripe (truth source). Fixes a
 *  status left stale by out-of-order webhook delivery. Admin only. */
billingRouter.post(
  "/refresh",
  requireAuth,
  requireScope,
  requireScopeRole(ScopedRole.WORKSPACE_ADMIN),
  asyncHandler(async (req, res) => {
    const workspaceId = req.scope!.workspaceId;
    const sub = await prisma.subscription.findUnique({ where: { workspaceId } });
    if (!sub?.stripeSubscriptionId) throw new BadRequestError("Geen Stripe-abonnement om te verversen");
    const live = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    await upsertSubscription(workspaceId, live, live.customer as string | null);
    const updated = await prisma.subscription.findUnique({ where: { workspaceId } });
    res.json({ status: updated?.status, validUntil: updated?.validUntil });
  }),
);

/** Undo a pending cancellation (keep the subscription + incasso running). */
billingRouter.post(
  "/resume",
  requireAuth,
  requireScope,
  requireScopeRole(ScopedRole.WORKSPACE_ADMIN),
  asyncHandler(async (req, res) => {
    const workspaceId = req.scope!.workspaceId;
    const sub = await prisma.subscription.findUnique({ where: { workspaceId } });
    if (!sub?.stripeSubscriptionId) throw new BadRequestError("Geen Stripe-abonnement gevonden");
    await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: false });
    await prisma.subscription.update({ where: { workspaceId }, data: { cancelAtPeriodEnd: false } });
    await prisma.auditLog.create({
      data: { workspaceId, userId: req.user!.id, action: "subscription.cancel_revoked", metadata: {} },
    });
    res.json({ cancelAtPeriodEnd: false });
  }),
);

/* -------------------------------------------------------------------------- */
/*  Webhook (mounted separately in app.ts BEFORE express.json)                 */
/* -------------------------------------------------------------------------- */

export const stripeWebhookRouter = Router();

stripeWebhookRouter.post(
  "/",
  express.raw({ type: "application/json" }),
  asyncHandler(async (req, res) => {
    const sig = req.header("stripe-signature");
    if (!sig) {
      res.status(400).send("Missing stripe-signature");
      return;
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      logger.warn({ err }, "Invalid Stripe webhook signature");
      res.status(400).send("Invalid signature");
      return;
    }

    // Idempotency: claim the event id first. Stripe delivers at-least-once, so a
    // retry (or a duplicate) must not reprocess. createMany+skipDuplicates is a
    // single atomic INSERT ... ON CONFLICT DO NOTHING; count 0 means we've seen it.
    const claim = await prisma.processedStripeEvent.createMany({
      data: [{ eventId: event.id, type: event.type }],
      skipDuplicates: true,
    });
    if (claim.count === 0) {
      logger.debug({ eventId: event.id, type: event.type }, "Duplicate Stripe event ignored");
      res.json({ received: true, duplicate: true });
      return;
    }

    try {
      await handleStripeEvent(event);
      res.json({ received: true });
    } catch (err) {
      // Roll back the claim so Stripe's retry can reprocess this event.
      await prisma.processedStripeEvent
        .delete({ where: { eventId: event.id } })
        .catch(() => undefined);
      logger.error({ err, eventType: event.type }, "Failed to handle Stripe event");
      res.status(500).send("Handler error");
    }
  }),
);

async function handleStripeEvent(event: import("stripe").Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as import("stripe").Stripe.Checkout.Session;
      const workspaceId = session.metadata?.workspaceId ?? session.client_reference_id;
      if (!workspaceId || !session.subscription) return;
      const sub = await stripe.subscriptions.retrieve(session.subscription as string);
      await upsertSubscription(workspaceId, sub, session.customer as string | null);
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const evtSub = event.data.object as import("stripe").Stripe.Subscription;
      const workspaceId = evtSub.metadata?.workspaceId;
      if (!workspaceId) {
        logger.warn({ subId: evtSub.id }, "Subscription event without workspaceId metadata");
        return;
      }
      // Stripe does NOT guarantee webhook ordering. Re-fetch the live subscription
      // so a late-delivered older event (e.g. "incomplete") can't overwrite a
      // newer status (e.g. "active"). Fall back to the event payload on failure.
      let sub = evtSub;
      try {
        sub = await stripe.subscriptions.retrieve(evtSub.id);
      } catch (e) {
        logger.warn({ err: e, subId: evtSub.id }, "Could not re-fetch subscription; using event payload");
      }
      await upsertSubscription(workspaceId, sub, sub.customer as string | null);
      break;
    }
    default:
      logger.debug({ type: event.type }, "Ignoring Stripe event");
  }
}

async function upsertSubscription(
  workspaceId: string,
  sub: import("stripe").Stripe.Subscription,
  customerId: string | null,
): Promise<void> {
  const item = sub.items.data[0];
  const priceId = item?.price.id;
  const status = mapStripeStatus(sub.status);
  // Resolve the managed plan: match the price-id against the catalog first (covers
  // prices configured per-plan), then fall back to the env-based enum mapping.
  const enumFromPrice = planFromPriceId(priceId);
  const planRow =
    (priceId ? await prisma.plan.findFirst({ where: { stripePriceId: priceId } }) : null) ??
    (enumFromPrice ? await prisma.plan.findUnique({ where: { key: enumFromPrice } }) : null);
  // Legacy enum column: keep it set when the plan key is a known enum value.
  const plan =
    enumFromPrice ??
    (planRow && planRow.key in SubscriptionPlan ? (planRow.key as SubscriptionPlan) : null);

  // current_period_end moved from Subscription → SubscriptionItem in recent Stripe
  // API versions. Read from item first, fall back to subscription for older API
  // versions. Cast through unknown to handle both type shapes.
  const cpeRaw =
    (item as unknown as { current_period_end?: number } | undefined)?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;
  const validUntil = typeof cpeRaw === "number" ? new Date(cpeRaw * 1000) : null;
  const cancelAtPeriodEnd = sub.cancel_at_period_end === true;

  await prisma.subscription.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      plan,
      planId: planRow?.id ?? null,
      status,
      validUntil,
      cancelAtPeriodEnd,
    },
    update: {
      stripeCustomerId: customerId ?? undefined,
      stripeSubscriptionId: sub.id,
      plan: plan ?? undefined,
      planId: planRow?.id ?? undefined,
      status,
      validUntil,
      cancelAtPeriodEnd,
    },
  });

  await prisma.auditLog.create({
    data: {
      workspaceId,
      action: "subscription.updated",
      metadata: { status, plan, stripeSubscriptionId: sub.id },
    },
  });
}

import type { RequestHandler } from "express";
import { prisma } from "../config/prisma.js";
import { SubscriptionRequiredError } from "../utils/errors.js";
import { isSubscriptionActive } from "../services/subscription.service.js";
import { isPlatformAdmin } from "./auth.js";

/**
 * Gate premium endpoints (exports, syncs) behind an active subscription.
 * Billing lives at the workspace, so this must run AFTER requireScope.
 *
 * The platform superuser bypasses this gate entirely; no normal user does.
 */
export const requireActiveSubscription: RequestHandler = async (req, _res, next) => {
  try {
    if (isPlatformAdmin(req)) return next();
    if (!req.scope) throw new SubscriptionRequiredError("No workspace context");
    const sub = await prisma.subscription.findUnique({
      where: { workspaceId: req.scope.workspaceId },
    });
    if (!isSubscriptionActive(sub)) {
      throw new SubscriptionRequiredError(
        "Premium feature requires an active subscription. Please upgrade in Billing.",
      );
    }
    next();
  } catch (err) {
    next(err);
  }
};

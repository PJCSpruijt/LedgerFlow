import type { RequestHandler } from "express";
import { prisma } from "../config/prisma.js";
import { ModuleRequiredError, SubscriptionRequiredError } from "../utils/errors.js";
import { isSubscriptionActive } from "../services/subscription.service.js";
import { getWorkspaceEntitlements } from "../services/plan.service.js";
import { MODULES, type ModuleKey } from "../config/modules.js";
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

const MODULE_LABEL: Record<string, string> = Object.fromEntries(
  MODULES.map((m) => [m.key, m.label]),
);

/**
 * Gate an endpoint behind a specific feature module. Requires an active
 * subscription whose plan includes `moduleKey`. Must run AFTER requireScope.
 * The platform superuser bypasses this entirely.
 */
export function requireModule(moduleKey: ModuleKey): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (isPlatformAdmin(req)) return next();
      if (!req.scope) throw new SubscriptionRequiredError("No workspace context");
      const ent = await getWorkspaceEntitlements(req.scope.workspaceId);
      if (!ent.active) {
        throw new SubscriptionRequiredError(
          "Premium feature requires an active subscription. Please upgrade in Billing.",
        );
      }
      if (!ent.modules.includes(moduleKey)) {
        throw new ModuleRequiredError(
          `Je huidige plan bevat de module "${MODULE_LABEL[moduleKey] ?? moduleKey}" niet. Upgrade je abonnement om deze functie te gebruiken.`,
          { module: moduleKey },
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

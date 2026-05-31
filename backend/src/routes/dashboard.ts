import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireScope } from "../middleware/auth.js";
import { requireActiveSubscription } from "../middleware/subscription.js";
import { validateQuery } from "../middleware/validate.js";
import { computeDashboardKpis } from "../services/dashboard.service.js";

/**
 * Dashboard KPIs for the current scope (group, or the whole workspace),
 * consolidated with transaction-level intercompany elimination. Available to any
 * active subscription — for a single administration it simply reflects that one.
 */
export const dashboardRouter = Router();

dashboardRouter.use(requireAuth, requireScope, requireActiveSubscription);

const KpiQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be yyyy-MM-dd"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be yyyy-MM-dd"),
  currency: z.string().length(3).optional(),
  scope: z.enum(["group", "workspace"]).optional(),
});

dashboardRouter.get(
  "/kpis",
  validateQuery(KpiQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof KpiQuery>;
    const workspaceId = req.scope!.workspaceId;
    const groupId = q.scope === "workspace" ? null : req.scope!.groupId ?? null;
    const kpis = await computeDashboardKpis({
      workspaceId,
      groupId,
      from: q.from,
      to: q.to,
      currency: (q.currency ?? "EUR").toUpperCase(),
    });
    res.json(kpis);
  }),
);

import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireScope } from "../middleware/auth.js";
import { requireActiveSubscription } from "../middleware/subscription.js";
import { validateQuery } from "../middleware/validate.js";
import { computeAging } from "../services/aging.service.js";
import { computeDataQuality } from "../services/data-quality.service.js";

/**
 * Reporting API — consolidated, scope-aware financial reports. Currently serves
 * the receivables/payables aging report (#55).
 */
export const reportingRouter = Router();

reportingRouter.use(requireAuth, requireScope, requireActiveSubscription);

const AgingQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().length(3).optional(),
  scope: z.enum(["group", "workspace"]).optional(),
  refresh: z.string().optional(),
});

reportingRouter.get(
  "/aging",
  validateQuery(AgingQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof AgingQuery>;
    const groupId = q.scope === "workspace" ? null : req.scope!.groupId ?? null;
    res.json(
      await computeAging({
        workspaceId: req.scope!.workspaceId,
        groupId,
        from: q.from,
        to: q.to,
        currency: (q.currency ?? "EUR").toUpperCase(),
        refresh: q.refresh === "1",
      }),
    );
  }),
);

const DqQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.enum(["group", "workspace"]).optional(),
  refresh: z.string().optional(),
});

reportingRouter.get(
  "/data-quality",
  validateQuery(DqQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof DqQuery>;
    const groupId = q.scope === "workspace" ? null : req.scope!.groupId ?? null;
    res.json(
      await computeDataQuality({
        workspaceId: req.scope!.workspaceId,
        groupId,
        from: q.from,
        to: q.to,
        refresh: q.refresh === "1",
      }),
    );
  }),
);

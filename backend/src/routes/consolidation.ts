import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireScope } from "../middleware/auth.js";
import { requireModule } from "../middleware/subscription.js";
import { validateQuery } from "../middleware/validate.js";
import { consolidate } from "../services/consolidation.service.js";

/**
 * Internal consolidation API (RGS-B). Consolidates every administration in the
 * current scope — the selected group, or the whole workspace when no group is
 * picked — into one RGS-keyed, single-currency set of figures with a per-entity
 * breakdown. Gated behind the CONSOLIDATION module (platform admin bypasses).
 */
export const consolidationRouter = Router();

consolidationRouter.use(requireAuth, requireScope, requireModule("CONSOLIDATION"));

const SummaryQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be yyyy-MM-dd"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be yyyy-MM-dd"),
  currency: z.string().length(3).optional(),
  /** "group" (default) consolidates the selected group; "workspace" forces the whole workspace. */
  scope: z.enum(["group", "workspace"]).optional(),
});

consolidationRouter.get(
  "/summary",
  validateQuery(SummaryQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof SummaryQuery>;
    const workspaceId = req.scope!.workspaceId;
    const groupId = q.scope === "workspace" ? null : req.scope!.groupId ?? null;
    const result = await consolidate({
      workspaceId,
      groupId,
      from: q.from,
      to: q.to,
      currency: (q.currency ?? "EUR").toUpperCase(),
    });
    res.json(result);
  }),
);

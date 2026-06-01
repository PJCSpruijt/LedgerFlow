import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireScope } from "../middleware/auth.js";
import { requireModule } from "../middleware/subscription.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { consolidate } from "../services/consolidation.service.js";
import { listIntercompany, setIntercompany } from "../services/intercompany.service.js";
import {
  createConsolidationRun,
  listConsolidationRuns,
  getConsolidationRun,
  deleteConsolidationRun,
} from "../services/consolidation-run.service.js";
import { listAdjustments, createAdjustment, deleteAdjustment } from "../services/consolidation-adjustment.service.js";
import { reconcileIntercompany } from "../services/intercompany-reconciliation.service.js";
import { NotFoundError } from "../utils/errors.js";
import { validateParams } from "../middleware/validate.js";

/**
 * Internal consolidation API (RGS-B). Consolidates every administration in the
 * current scope — the selected group, or the whole workspace when no group is
 * picked — into one RGS-keyed, single-currency set of figures with a per-entity
 * breakdown, plus intercompany mapping + elimination. Gated behind the
 * CONSOLIDATION module (platform admin bypasses).
 */
export const consolidationRouter = Router();

consolidationRouter.use(requireAuth, requireScope, requireModule("CONSOLIDATION"));

const SummaryQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be yyyy-MM-dd"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be yyyy-MM-dd"),
  currency: z.string().length(3).optional(),
  /** "group" (default) consolidates the selected group; "workspace" forces the whole workspace. */
  scope: z.enum(["group", "workspace"]).optional(),
  /** "1" also computes intercompany eliminations + imbalance warnings. */
  eliminate: z.enum(["0", "1"]).optional(),
  /** "1" bypasses the connector day-cache and re-fetches live. */
  refresh: z.string().optional(),
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
      eliminate: q.eliminate === "1",
      refresh: q.refresh === "1",
    });
    res.json(result);
  }),
);

// ---- Intercompany relation mapping ----------------------------------------

consolidationRouter.get(
  "/intercompany",
  asyncHandler(async (req, res) => {
    const workspaceId = req.scope!.workspaceId;
    const scope = String(req.query.scope ?? "");
    const groupId = scope === "workspace" ? null : req.scope!.groupId ?? null;
    res.json(await listIntercompany(workspaceId, groupId));
  }),
);

const SetIcBody = z.object({
  entityId: z.string().min(1),
  relationId: z.string().min(1),
  relationCode: z.string().nullable().optional(),
  relationName: z.string().nullable().optional(),
  counterpartyEntityId: z.string().nullable(),
});

consolidationRouter.post(
  "/intercompany",
  validateBody(SetIcBody),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof SetIcBody>;
    await setIntercompany({
      workspaceId: req.scope!.workspaceId,
      entityId: b.entityId,
      relationId: b.relationId,
      relationCode: b.relationCode ?? null,
      relationName: b.relationName ?? null,
      counterpartyEntityId: b.counterpartyEntityId,
      userId: req.user?.id ?? null,
    });
    res.json({ ok: true });
  }),
);

// ---- Intercompany reconciliation (typed mismatch report) ------------------

const ReconQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().length(3).optional(),
  scope: z.enum(["group", "workspace"]).optional(),
  refresh: z.string().optional(),
});

consolidationRouter.get(
  "/reconciliation",
  validateQuery(ReconQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof ReconQuery>;
    const groupId = q.scope === "workspace" ? null : req.scope!.groupId ?? null;
    res.json(
      await reconcileIntercompany({
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

// ---- Consolidation runs (snapshots) ---------------------------------------

const CreateRunBody = z.object({
  label: z.string().max(120).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().length(3).optional(),
  scope: z.enum(["group", "workspace"]).optional(),
  eliminate: z.boolean().optional(),
});

consolidationRouter.get(
  "/runs",
  asyncHandler(async (req, res) => {
    res.json({ runs: await listConsolidationRuns(req.scope!.workspaceId) });
  }),
);

consolidationRouter.post(
  "/runs",
  validateBody(CreateRunBody),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof CreateRunBody>;
    const scope = b.scope ?? (req.scope!.groupId ? "group" : "workspace");
    const run = await createConsolidationRun({
      workspaceId: req.scope!.workspaceId,
      groupId: req.scope!.groupId ?? null,
      scope,
      from: b.from,
      to: b.to,
      currency: (b.currency ?? "EUR").toUpperCase(),
      eliminate: b.eliminate ?? false,
      label: b.label ?? "",
      userId: req.user?.id ?? null,
    });
    res.status(201).json({ run });
  }),
);

const IdParam = z.object({ id: z.string().min(1) });

consolidationRouter.get(
  "/runs/:id",
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    const run = await getConsolidationRun(req.scope!.workspaceId, String(req.params.id));
    if (!run) throw new NotFoundError("Consolidatierun niet gevonden");
    res.json({ run });
  }),
);

consolidationRouter.delete(
  "/runs/:id",
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    const ok = await deleteConsolidationRun(req.scope!.workspaceId, String(req.params.id));
    if (!ok) throw new NotFoundError("Consolidatierun niet gevonden");
    res.json({ ok: true });
  }),
);

// ---- Consolidation adjustments (manual corrections) -----------------------

consolidationRouter.get(
  "/adjustments",
  asyncHandler(async (req, res) => {
    res.json({ adjustments: await listAdjustments(req.scope!.workspaceId, req.scope!.groupId ?? null) });
  }),
);

const CreateAdjBody = z.object({
  description: z.string().min(1).max(200),
  debitRgsCode: z.string().min(2).max(40),
  creditRgsCode: z.string().min(2).max(40),
  amount: z.number().positive(),
  currency: z.string().length(3).optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scope: z.enum(["group", "workspace"]).optional(),
});

consolidationRouter.post(
  "/adjustments",
  validateBody(CreateAdjBody),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof CreateAdjBody>;
    const groupId = b.scope === "workspace" ? null : req.scope!.groupId ?? null;
    const adj = await createAdjustment({
      workspaceId: req.scope!.workspaceId,
      groupId,
      description: b.description,
      debitRgsCode: b.debitRgsCode,
      creditRgsCode: b.creditRgsCode,
      amount: b.amount,
      currency: b.currency ?? "EUR",
      effectiveDate: b.effectiveDate,
      userId: req.user?.id ?? null,
    });
    res.status(201).json({ adjustment: adj });
  }),
);

consolidationRouter.delete(
  "/adjustments/:id",
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    const ok = await deleteAdjustment(req.scope!.workspaceId, String(req.params.id));
    if (!ok) throw new NotFoundError("Correctie niet gevonden");
    res.json({ ok: true });
  }),
);

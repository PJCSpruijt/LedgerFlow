import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  requireAuth,
  requireScope,
  requireScopeRole,
  SCOPE_ADMIN_ROLES,
} from "../middleware/auth.js";
import { requireModule } from "../middleware/subscription.js";
import { BadRequestError } from "../utils/errors.js";
import { searchRgsAccounts } from "../services/rgs-import.service.js";
import { listSourceAccounts, syncSourceAccounts } from "../services/source-account.service.js";
import {
  getActiveMappings,
  getMappingHistory,
  listFinCategories,
  resolveRgsVersion,
  setMapping,
  suggestForAccounts,
} from "../services/rgs-mapping.service.js";

export const rgsMappingRouter = Router();

// RGS is a gated module. requireModule needs req.scope, so resolve scope first;
// platform admins bypass the entitlement check inside requireModule. The
// per-workspace on/off switch (rgsEnabled) gates the enrichment + UI separately.
rgsMappingRouter.use(requireAuth, requireScope, requireModule("RGS"));

/** RGS mapping is entity-scoped — an administration must be selected. */
function requireEntity(req: import("express").Request): string {
  const entityId = req.scope?.entityId;
  if (!entityId) throw new BadRequestError("Selecteer een administratie voor RGS-koppelingen");
  return entityId;
}

/** FIN semantic categories available to this workspace (platform defaults + own). */
rgsMappingRouter.get(
  "/fin-categories",
  requireAuth,
  requireScope,
  asyncHandler(async (req, res) => {
    res.json({ categories: await listFinCategories(req.scope!.workspaceId) });
  }),
);

/** Discover/refresh the entity's source accounts from its connector. */
rgsMappingRouter.post(
  "/sync",
  requireAuth,
  requireScope,
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    res.json(await syncSourceAccounts(requireEntity(req)));
  }),
);

/**
 * The mapping workbench: every source account with its current mapping and
 * ranked RGS suggestions for the workspace's effective RGS version.
 */
rgsMappingRouter.get(
  "/",
  requireAuth,
  requireScope,
  asyncHandler(async (req, res) => {
    const entityId = requireEntity(req);
    const workspaceId = req.scope!.workspaceId;
    const version = await resolveRgsVersion(workspaceId);

    const accounts = await listSourceAccounts(entityId);
    const active = await getActiveMappings(entityId);
    const mapByCode = new Map(active.map((m) => [m.sourceAccountCode, m]));
    const suggestions = await suggestForAccounts(
      workspaceId,
      version,
      accounts.map((a) => ({ code: a.code, name: a.name, accountType: a.accountType })),
    );

    res.json({
      version,
      accounts: accounts.map((a) => {
        const m = mapByCode.get(a.code);
        return {
          code: a.code,
          name: a.name,
          accountType: a.accountType,
          mapping: m
            ? {
                rgsCode: m.rgsCode,
                finCategoryId: m.finCategoryId,
                finCategoryKey: m.finCategory?.key ?? null,
                confidence: m.confidence,
              }
            : null,
          suggestions: suggestions.get(a.code) ?? [],
        };
      }),
    });
  }),
);

const RgsSearchQuery = z.object({
  q: z.string().min(1).max(80),
  // Optionally constrain to the balans (B) or winst&verlies (W) side.
  side: z.enum(["B", "W"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/** Typeahead over the workspace's effective RGS version (code + omschrijving). */
rgsMappingRouter.get(
  "/rgs-search",
  validateQuery(RgsSearchQuery),
  asyncHandler(async (req, res) => {
    const workspaceId = req.scope!.workspaceId;
    const version = await resolveRgsVersion(workspaceId);
    const { q, side, limit } = req.query as unknown as z.infer<typeof RgsSearchQuery>;
    const rows = (await searchRgsAccounts({ version, q, limit: limit ?? 25 })) as {
      code: string;
      description: string;
      level: number;
      isBalanceSheet: boolean;
      isProfitLoss: boolean;
      dc: string | null;
    }[];
    const filtered = side
      ? rows.filter((r) => (side === "B" ? r.isBalanceSheet : r.isProfitLoss))
      : rows;
    res.json({
      version,
      results: filtered.map((r) => ({
        code: r.code,
        description: r.description,
        level: r.level,
        isBalanceSheet: r.isBalanceSheet,
        isProfitLoss: r.isProfitLoss,
      })),
    });
  }),
);

const SetSchema = z.object({
  sourceAccountCode: z.string().min(1).max(64),
  rgsCode: z.string().max(32).nullable().optional(),
  finCategoryId: z.string().uuid().nullable().optional(),
  confidence: z.enum(["EXACT", "SUGGESTED", "MANUAL"]).optional(),
});

/** Set/override a mapping (append-only + audited). */
rgsMappingRouter.post(
  "/",
  requireAuth,
  requireScope,
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateBody(SetSchema),
  asyncHandler(async (req, res) => {
    const entityId = requireEntity(req);
    const workspaceId = req.scope!.workspaceId;
    const body = req.body as z.infer<typeof SetSchema>;

    // Validate the RGS code exists in the effective version (if provided).
    const version = await resolveRgsVersion(workspaceId);
    if (body.rgsCode) {
      const exists = await prisma.rgsAccount.findUnique({
        where: { version_code: { version, code: body.rgsCode } },
        select: { code: true },
      });
      if (!exists) throw new BadRequestError(`Onbekende RGS-code ${body.rgsCode} (versie ${version})`);
    }
    if (body.finCategoryId) {
      const cat = await prisma.finSemanticCategory.findFirst({
        where: { id: body.finCategoryId, OR: [{ workspaceId: null }, { workspaceId }] },
        select: { id: true },
      });
      if (!cat) throw new BadRequestError("Onbekende FIN-categorie");
    }

    const mapping = await setMapping({
      workspaceId,
      entityId,
      sourceAccountCode: body.sourceAccountCode,
      rgsVersion: version,
      rgsCode: body.rgsCode ?? null,
      finCategoryId: body.finCategoryId ?? null,
      confidence: body.confidence,
      userId: req.user!.id,
    });
    res.status(201).json({ mapping });
  }),
);

const HistoryQuery = z.object({ code: z.string().min(1) });

/** Append-only mapping history for one source account. */
rgsMappingRouter.get(
  "/history",
  requireAuth,
  requireScope,
  validateQuery(HistoryQuery),
  asyncHandler(async (req, res) => {
    const entityId = requireEntity(req);
    const { code } = req.query as unknown as z.infer<typeof HistoryQuery>;
    res.json({ history: await getMappingHistory(entityId, code) });
  }),
);

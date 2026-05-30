import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import {
  isPlatformAdmin,
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

const FinCreateSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(40)
    .regex(/^[A-Za-z0-9_]+$/, "Alleen letters, cijfers en _ toegestaan"),
  label: z.string().min(1).max(80),
  kind: z.enum(["REVENUE", "COST", "METRIC"]).default("METRIC"),
  description: z.string().max(200).optional(),
  sortOrder: z.coerce.number().int().optional(),
  // Platform admins may create a platform-wide default (shared by all workspaces).
  asDefault: z.boolean().optional(),
});

/** Create a FIN semantic category (workspace-owned, or platform-default for admins). */
rgsMappingRouter.post(
  "/fin-categories",
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateBody(FinCreateSchema),
  asyncHandler(async (req, res) => {
    const workspaceId = req.scope!.workspaceId;
    const body = req.body as z.infer<typeof FinCreateSchema>;
    const key = body.key.toUpperCase();
    const asDefault = !!body.asDefault && isPlatformAdmin(req);
    const targetWorkspaceId = asDefault ? null : workspaceId;

    const clashDefault = await prisma.finSemanticCategory.findFirst({
      where: { workspaceId: null, key },
      select: { id: true },
    });
    if (clashDefault) throw new BadRequestError("Deze sleutel bestaat al als standaardcategorie");
    if (!asDefault) {
      const clashOwn = await prisma.finSemanticCategory.findFirst({
        where: { workspaceId, key },
        select: { id: true },
      });
      if (clashOwn) throw new BadRequestError("Deze sleutel bestaat al in deze werkruimte");
    }
    const category = await prisma.finSemanticCategory.create({
      data: {
        workspaceId: targetWorkspaceId,
        key,
        label: body.label,
        kind: body.kind,
        description: body.description ?? null,
        sortOrder: body.sortOrder ?? 100,
      },
    });
    res.status(201).json({ category });
  }),
);

const FinIdParam = z.object({ id: z.string().uuid() });
const FinUpdateSchema = z.object({
  label: z.string().min(1).max(80).optional(),
  kind: z.enum(["REVENUE", "COST", "METRIC"]).optional(),
  description: z.string().max(200).nullable().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

/** Edit a workspace-owned FIN category (platform defaults are read-only). */
rgsMappingRouter.patch(
  "/fin-categories/:id",
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateParams(FinIdParam),
  validateBody(FinUpdateSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof FinIdParam>;
    const cat = await prisma.finSemanticCategory.findUnique({ where: { id } });
    const mayEdit =
      cat &&
      (cat.workspaceId === req.scope!.workspaceId ||
        (cat.workspaceId === null && isPlatformAdmin(req)));
    if (!mayEdit) {
      throw new BadRequestError(
        "Alleen eigen categorieën — of standaarden als platformbeheerder — kunnen worden bewerkt",
      );
    }
    const category = await prisma.finSemanticCategory.update({
      where: { id },
      data: req.body as z.infer<typeof FinUpdateSchema>,
    });
    res.json({ category });
  }),
);

/** Delete a workspace-owned FIN category (mappings keep working; link is cleared). */
rgsMappingRouter.delete(
  "/fin-categories/:id",
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateParams(FinIdParam),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof FinIdParam>;
    const cat = await prisma.finSemanticCategory.findUnique({ where: { id } });
    const mayDelete =
      cat &&
      (cat.workspaceId === req.scope!.workspaceId ||
        (cat.workspaceId === null && isPlatformAdmin(req)));
    if (!mayDelete) {
      throw new BadRequestError(
        "Alleen eigen categorieën — of standaarden als platformbeheerder — kunnen worden verwijderd",
      );
    }
    await prisma.finSemanticCategory.delete({ where: { id } });
    res.json({ ok: true });
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

/**
 * Consolidated normalized chart ("Universeel rekeningschema"): the RGS codes
 * actually in use across the current scope (workspace / group / entity), each
 * with the underlying source accounts per administration, plus the source
 * accounts that are not yet mapped. Read-only — mapping happens on GET / + POST.
 */
rgsMappingRouter.get(
  "/universal",
  asyncHandler(async (req, res) => {
    const workspaceId = req.scope!.workspaceId;
    const { entityId, groupId } = req.scope!;
    const entities = await prisma.entity.findMany({
      where: entityId ? { id: entityId } : groupId ? { groupId } : { group: { workspaceId } },
      select: { id: true, name: true },
    });
    const entityIds = entities.map((e) => e.id);
    const nameById = new Map(entities.map((e) => [e.id, e.name]));
    const version = await resolveRgsVersion(workspaceId);
    if (entityIds.length === 0) {
      res.json({ version, entities: [], groups: [], unmapped: [] });
      return;
    }

    const [mappings, sources] = await Promise.all([
      prisma.sourceAccountMapping.findMany({
        where: { entityId: { in: entityIds }, supersededAt: null },
        include: { finCategory: true },
      }),
      prisma.sourceAccount.findMany({
        where: { entityId: { in: entityIds } },
        select: { entityId: true, code: true, name: true },
      }),
    ]);
    const sourceNameByKey = new Map(sources.map((s) => [`${s.entityId}:${s.code}`, s.name]));

    const codes = [...new Set(mappings.map((m) => m.rgsCode).filter((c): c is string => !!c))];
    const rgs = codes.length
      ? await prisma.rgsAccount.findMany({
          where: { version, code: { in: codes } },
          select: { code: true, description: true, level: true, isBalanceSheet: true, isProfitLoss: true },
        })
      : [];
    const rgsByCode = new Map(rgs.map((r) => [r.code, r]));

    interface Entry {
      entityId: string;
      entityName: string;
      sourceCode: string;
      sourceName: string;
    }
    interface GroupAcc {
      rgsCode: string;
      description: string;
      level: number;
      side: "B" | "W" | null;
      finCategories: Set<string>;
      entries: Entry[];
    }
    const groups = new Map<string, GroupAcc>();
    const mappedKeys = new Set<string>();
    for (const m of mappings) {
      if (!m.rgsCode) continue;
      mappedKeys.add(`${m.entityId}:${m.sourceAccountCode}`);
      const meta = rgsByCode.get(m.rgsCode);
      const g =
        groups.get(m.rgsCode) ??
        ({
          rgsCode: m.rgsCode,
          description: meta?.description ?? "(onbekende RGS-code)",
          level: meta?.level ?? 0,
          side: meta?.isBalanceSheet ? "B" : meta?.isProfitLoss ? "W" : null,
          finCategories: new Set<string>(),
          entries: [],
        } as GroupAcc);
      if (m.finCategory?.key) g.finCategories.add(m.finCategory.key);
      g.entries.push({
        entityId: m.entityId,
        entityName: nameById.get(m.entityId) ?? m.entityId,
        sourceCode: m.sourceAccountCode,
        sourceName: sourceNameByKey.get(`${m.entityId}:${m.sourceAccountCode}`) ?? m.sourceAccountCode,
      });
      groups.set(m.rgsCode, g);
    }

    const unmapped: Entry[] = sources
      .filter((s) => !mappedKeys.has(`${s.entityId}:${s.code}`))
      .map((s) => ({
        entityId: s.entityId,
        entityName: nameById.get(s.entityId) ?? s.entityId,
        sourceCode: s.code,
        sourceName: s.name,
      }));

    const out = [...groups.values()]
      .map((g) => ({
        rgsCode: g.rgsCode,
        description: g.description,
        level: g.level,
        side: g.side,
        finCategories: [...g.finCategories],
        count: g.entries.length,
        entries: g.entries.sort((a, b) => a.entityName.localeCompare(b.entityName)),
      }))
      .sort((a, b) => a.rgsCode.localeCompare(b.rgsCode));

    res.json({ version, entities, groups: out, unmapped });
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

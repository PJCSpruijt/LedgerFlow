import { prisma } from "../config/prisma.js";
import type { TransactionLine, TrialBalanceLine } from "../clients/connectors/interfaces/Connector.js";

/**
 * RGS mapping layer: source GL account → RGS code (+ optional FIN semantic
 * category). Mappings are IMMUTABLE and AUDITABLE — a change never updates a
 * row, it supersedes the previous active row and inserts a new one. Resolution
 * mirrors the VAT-mapping precedence (an entity's own mapping wins).
 */

/** Platform-default FIN semantic categories (workspaceId null), seeded lazily. */
const DEFAULT_FIN_CATEGORIES: { key: string; label: string; kind: string }[] = [
  { key: "MRR", label: "MRR", kind: "REVENUE" },
  { key: "ARR", label: "ARR", kind: "REVENUE" },
  { key: "SAAS_REVENUE", label: "SaaS Revenue", kind: "REVENUE" },
  { key: "PROF_SERVICES", label: "Professional Services", kind: "REVENUE" },
  { key: "BURN", label: "Burn", kind: "METRIC" },
  { key: "EBITDA", label: "EBITDA", kind: "METRIC" },
];

/** FIN categories visible to a workspace: platform defaults + the workspace's own. */
export async function listFinCategories(workspaceId: string) {
  const existing = await prisma.finSemanticCategory.findMany({
    where: { workspaceId: null },
    select: { key: true },
  });
  const have = new Set(existing.map((c) => c.key));
  const missing = DEFAULT_FIN_CATEGORIES.filter((d) => !have.has(d.key));
  if (missing.length) {
    await prisma.finSemanticCategory.createMany({
      data: missing.map((d, i) => ({ ...d, workspaceId: null, sortOrder: i })),
    });
  }
  return prisma.finSemanticCategory.findMany({
    where: { OR: [{ workspaceId: null }, { workspaceId }] },
    orderBy: [{ workspaceId: "asc" }, { sortOrder: "asc" }, { key: "asc" }],
  });
}

/** Effective RGS version for a workspace: its setting if loaded, else newest. */
export async function resolveRgsVersion(workspaceId: string): Promise<string> {
  const settings = await prisma.workspaceSettings.findUnique({ where: { workspaceId } });
  const wanted = settings?.rgsVersion ?? "3.5";
  const has = await prisma.rgsAccount.count({ where: { version: wanted } });
  if (has > 0) return wanted;
  const newest = await prisma.rgsAccount.findFirst({
    orderBy: { version: "desc" },
    select: { version: true },
  });
  return newest?.version ?? wanted;
}

/** Active (non-superseded) mappings for an entity, keyed by source account code. */
export async function getActiveMappings(entityId: string) {
  return prisma.sourceAccountMapping.findMany({
    where: { entityId, supersededAt: null },
    include: { finCategory: true },
  });
}

/** Append-only mapping change: supersede the current row, insert the new one. */
export async function setMapping(input: {
  workspaceId: string;
  entityId: string;
  sourceAccountCode: string;
  rgsVersion: string;
  rgsCode: string | null;
  finCategoryId: string | null;
  confidence?: "EXACT" | "SUGGESTED" | "MANUAL";
  userId: string | null;
}) {
  const { workspaceId, entityId, sourceAccountCode } = input;
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const prevActive = await tx.sourceAccountMapping.findFirst({
      where: { entityId, sourceAccountCode, supersededAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (prevActive) {
      await tx.sourceAccountMapping.update({
        where: { id: prevActive.id },
        data: { supersededAt: now },
      });
    }
    const created = await tx.sourceAccountMapping.create({
      data: {
        workspaceId,
        entityId,
        sourceAccountCode,
        rgsVersion: input.rgsVersion,
        rgsCode: input.rgsCode,
        finCategoryId: input.finCategoryId,
        confidence: input.confidence ?? "MANUAL",
        createdByUserId: input.userId,
      },
    });
    await tx.auditLog.create({
      data: {
        workspaceId,
        entityId,
        userId: input.userId,
        action: "rgs.mapping.changed",
        metadata: {
          sourceAccountCode,
          from: prevActive ? { rgsCode: prevActive.rgsCode, finCategoryId: prevActive.finCategoryId } : null,
          to: { rgsCode: input.rgsCode, finCategoryId: input.finCategoryId },
        },
      },
    });
    return created;
  });
}

/** Full append-only history for one source account (newest first). */
export async function getMappingHistory(entityId: string, sourceAccountCode: string) {
  return prisma.sourceAccountMapping.findMany({
    where: { entityId, sourceAccountCode },
    include: { finCategory: true },
    orderBy: { createdAt: "desc" },
  });
}

// ---- Rule-based suggestions -------------------------------------------------

const STOP = new Set([
  "van", "de", "het", "en", "op", "te", "aan", "voor", "met", "of", "der", "den",
  "in", "bij", "per", "een", "uit", "tot", "naar", "over", "the", "and",
]);
function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

export interface RgsSuggestion {
  rgsCode: string;
  description: string;
  level: number;
  score: number;
  source: "history" | "name";
}

/**
 * Suggest RGS codes for each source account. Strategy (AI ranking is a later
 * phase): (1) reuse a mapping another entity in the workspace already made for
 * the same source code; (2) fuzzy token-overlap of the account name against RGS
 * descriptions, constrained to the matching balans/W&V side. Returns top 3.
 */
export async function suggestForAccounts(
  workspaceId: string,
  version: string,
  accounts: { code: string; name: string; accountType: string }[],
): Promise<Map<string, RgsSuggestion[]>> {
  // Historical mappings across the workspace, keyed by source code.
  const history = await prisma.sourceAccountMapping.findMany({
    where: { workspaceId, supersededAt: null, rgsCode: { not: null } },
    select: { sourceAccountCode: true, rgsCode: true },
  });
  const histByCode = new Map<string, string>();
  for (const h of history) if (h.rgsCode) histByCode.set(h.sourceAccountCode, h.rgsCode);

  // Candidate pool: mappable leaf levels (account/mutation).
  const candidates = await prisma.rgsAccount.findMany({
    where: { version, level: { gte: 4 } },
    select: { code: true, description: true, level: true, isBalanceSheet: true, isProfitLoss: true },
  });
  const candTokens = candidates.map((c) => ({ ...c, toks: new Set(tokenize(c.description)) }));
  const descByCode = new Map(candidates.map((c) => [c.code, c.description]));

  const result = new Map<string, RgsSuggestion[]>();
  for (const acc of accounts) {
    const out: RgsSuggestion[] = [];
    const histCode = histByCode.get(acc.code);
    if (histCode && descByCode.has(histCode)) {
      out.push({ rgsCode: histCode, description: descByCode.get(histCode)!, level: 4, score: 100, source: "history" });
    }
    const wantB = acc.accountType === "BALANCE";
    const wantW = acc.accountType === "PROFIT_LOSS";
    const accToks = tokenize(acc.name);
    if (accToks.length) {
      const scored: RgsSuggestion[] = [];
      for (const c of candTokens) {
        if (wantB && !c.isBalanceSheet) continue;
        if (wantW && !c.isProfitLoss) continue;
        let overlap = 0;
        for (const t of accToks) if (c.toks.has(t)) overlap += 1;
        if (overlap > 0) {
          const score = (overlap / accToks.length) * 100 - c.level; // prefer specific, shorter
          scored.push({ rgsCode: c.code, description: c.description, level: c.level, score, source: "name" });
        }
      }
      scored.sort((a, b) => b.score - a.score);
      for (const s of scored) {
        if (out.length >= 3) break;
        if (!out.some((o) => o.rgsCode === s.rgsCode)) out.push(s);
      }
    }
    result.set(acc.code, out.slice(0, 3));
  }
  return result;
}

// ---- Normalization hook -----------------------------------------------------

/**
 * Attach rgsCode/rgsType/finCategory to connector lines from the active
 * mappings, WITHOUT mutating the raw source values. No-op when RGS is disabled
 * for the workspace or there are no mappings.
 */
export async function applyRgsMappings<T extends TransactionLine | TrialBalanceLine>(
  lines: T[],
  workspaceId: string,
  entityId: string,
): Promise<T[]> {
  const settings = await prisma.workspaceSettings.findUnique({ where: { workspaceId } });
  if (!settings?.rgsEnabled) return lines;

  const mappings = await getActiveMappings(entityId);
  if (mappings.length === 0) return lines;

  const byCode = new Map(mappings.map((m) => [m.sourceAccountCode, m]));
  // Resolve rgsType for the mapped codes in one query.
  const codes = [...new Set(mappings.map((m) => m.rgsCode).filter((c): c is string => !!c))];
  const rgsRows = codes.length
    ? await prisma.rgsAccount.findMany({
        where: { version: settings.rgsVersion, code: { in: codes } },
        select: { code: true, rgsType: true },
      })
    : [];
  const typeByCode = new Map(rgsRows.map((r) => [r.code, r.rgsType]));

  return lines.map((l) => {
    const m = byCode.get(l.glAccountCode);
    if (!m) return l;
    return {
      ...l,
      rgsCode: m.rgsCode ?? null,
      rgsType: m.rgsCode ? (typeByCode.get(m.rgsCode) ?? null) : null,
      finCategory: m.finCategory?.key ?? null,
    };
  });
}

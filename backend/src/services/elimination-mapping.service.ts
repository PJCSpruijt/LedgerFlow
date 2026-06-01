import { prisma } from "../config/prisma.js";
import { tryGetConnectorForEntity } from "../clients/connectors/registry.js";
import { applyRgsMappings } from "./rgs-mapping.service.js";
import { cachedTrialBalance } from "./connector-cache.service.js";
import { convert, prefetchRates } from "./fx.service.js";
import { normName } from "./intercompany.service.js";

/**
 * Per-account elimination mapping (capital / RC / loan consolidation).
 *
 * Two layers, combined:
 *  - Layer 1 (auto): for a balance account that NAMES a specific company
 *    (deelneming, groepsmaatschappij, rekening-courant, lening), the
 *    counterparty is resolved by matching the name to an administration IN the
 *    consolidation scope. If the named company is NOT in scope (e.g. a foreign
 *    sub that isn't consolidated), the account is NOT eliminated — it stays on
 *    the consolidated balance as a participation/receivable outside the group.
 *    Only generically-named accounts (no company in the name) fall back to "the
 *    other administration" in a two-entity group.
 *  - Layer 2 (manual): an explicit per-(entity, glAccountCode) override decides
 *    eliminate yes/no + the counterparty administration, winning over auto.
 *
 * The resolver here is the single source of truth consulted by both the
 * reconciliation report and the consolidation elimination engine, so a decision
 * made once applies everywhere.
 */

export type ElimCategory = "EQUITY_INVESTMENT" | "CURRENT_ACCOUNT" | "LOAN";

export const ELIM_CATEGORY_LABEL: Record<ElimCategory, string> = {
  EQUITY_INVESTMENT: "Deelneming / groepsmaatschappij",
  CURRENT_ACCOUNT: "Rekening-courant",
  LOAN: "Lening",
};

// Generic intragroup tokens that do NOT identify a specific company. When an
// account name contains nothing beyond these, it is "generic" (e.g. plain
// "Rekening-courant") and the two-entity fallback may apply. normName already
// strips legal forms (bv/nv/ltd/gmbh) and the words holding/group/groep.
const GENERIC_TOKENS = new Set([
  "groepsmaatschappij", "groepsmaatschappijen", "deelneming", "deelnemingen",
  "rekening", "courant", "rc", "lening", "leningen", "vordering", "vorderingen",
  "schuld", "schulden", "kortlopend", "kortlopende", "langlopend", "langlopende",
  "op", "aan", "van", "in", "bij", "te", "en", "met", "groep", "intercompany",
  "ic", "verbonden", "partij", "partijen", "maatschappij", "maatschappijen",
  "moedermaatschappij", "dochtermaatschappij", "moeder", "dochter", "onderneming",
  "ondernemingen", "overige", "overig", "diverse",
]);

/** Classify a balance account as an elimination candidate (or null). */
export function classifyElimAccount(
  name: string,
  rgsCode: string | null,
  rgsGroupCode: string | null,
): ElimCategory | null {
  const n = name.toLowerCase();
  const rgs = rgsCode ?? "";
  // Rekening-courant first — names overlap with "groepsmaatschappij".
  if (/rekening.?courant/.test(n) || /(^|\s)rc[\s/]/.test(n) || rgs.startsWith("BVorVog") || rgs.startsWith("BSchSag") || rgs.startsWith("BSchScg"))
    return "CURRENT_ACCOUNT";
  if (/lening/.test(n)) return "LOAN";
  if (rgs.startsWith("BFvaDig") || /deelneming|groep(s)?maatschapp/.test(n)) return "EQUITY_INVESTMENT";
  return null;
}

export interface ElimDecision {
  eliminate: boolean;
  counterpartyId: string | null;
  source: "manual" | "auto";
}

type Candidate = { id: string; n: string };

/**
 * Auto-decide elimination for an account name against the in-scope entities.
 * Layer-1 logic (no manual override applied here).
 */
export function autoDecide(entityId: string, accountName: string, cand: Candidate[]): ElimDecision {
  const an = normName(accountName);
  // 1. Account name references an in-scope administration → eliminate against it.
  const match = cand.find((c) => c.id !== entityId && c.n && (an === c.n || an.includes(c.n) || c.n.includes(an)));
  if (match) return { eliminate: true, counterpartyId: match.id, source: "auto" };
  // 2. Does the name identify a SPECIFIC (out-of-scope) company? If a substantive
  //    proper-noun remainder survives after stripping generic tokens, yes — and
  //    that company isn't consolidated, so the account must NOT be eliminated.
  const remainder = an.split(/\s+/).filter((w) => w.length >= 3 && !GENERIC_TOKENS.has(w));
  if (remainder.length > 0) return { eliminate: false, counterpartyId: null, source: "auto" };
  // 3. Purely generic name → in a two-entity group, the single other entity.
  const others = cand.filter((c) => c.id !== entityId);
  return others.length === 1 ? { eliminate: true, counterpartyId: others[0]!.id, source: "auto" } : { eliminate: false, counterpartyId: null, source: "auto" };
}

export interface EliminationResolver {
  resolve(entityId: string, glAccountCode: string, accountName: string): ElimDecision;
  /** True if an explicit override exists for this account. */
  hasOverride(entityId: string, glAccountCode: string): boolean;
}

/**
 * Build the resolver consulted by recon + consolidation. `entities` are the
 * in-scope administrations (id + name); overrides are loaded once.
 */
export async function buildEliminationResolver(
  workspaceId: string,
  entities: { id: string; name: string }[],
): Promise<EliminationResolver> {
  const cand: Candidate[] = entities.map((e) => ({ id: e.id, n: normName(e.name) }));
  const inScope = new Set(entities.map((e) => e.id));
  const rows = await prisma.eliminationAccountMapping.findMany({
    where: { workspaceId, entityId: { in: entities.map((e) => e.id) } },
    select: { entityId: true, glAccountCode: true, eliminate: true, counterpartyEntityId: true },
  });
  const overrides = new Map<string, { eliminate: boolean; counterpartyEntityId: string | null }>();
  for (const r of rows) overrides.set(`${r.entityId}|${r.glAccountCode}`, { eliminate: r.eliminate, counterpartyEntityId: r.counterpartyEntityId });

  return {
    hasOverride: (entityId, glAccountCode) => overrides.has(`${entityId}|${glAccountCode}`),
    resolve: (entityId, glAccountCode, accountName) => {
      const ov = overrides.get(`${entityId}|${glAccountCode}`);
      if (ov) {
        // A counterparty that left the scope is treated as "outside consolidation".
        const cp = ov.counterpartyEntityId && inScope.has(ov.counterpartyEntityId) ? ov.counterpartyEntityId : null;
        return { eliminate: ov.eliminate, counterpartyId: cp, source: "manual" };
      }
      return autoDecide(entityId, accountName, cand);
    },
  };
}

// ---- Candidate listing (for the UI) ---------------------------------------

export interface ElimAccountRow {
  entityId: string;
  entityName: string;
  glAccountCode: string;
  glAccountName: string;
  rgsCode: string | null;
  category: ElimCategory;
  categoryLabel: string;
  balance: number; // reporting currency
  /** Auto-detected decision (Layer 1). */
  autoEliminate: boolean;
  autoCounterpartyId: string | null;
  /** Manual override, if any (Layer 2). */
  overrideEliminate: boolean | null;
  overrideCounterpartyId: string | null;
  /** Effective decision after applying the override. */
  effectiveEliminate: boolean;
  effectiveCounterpartyId: string | null;
  source: "manual" | "auto";
}

export interface ElimAccountsResult {
  entities: { id: string; name: string }[];
  rows: ElimAccountRow[];
  cachedAt: string | null;
  warnings: string[];
}

/** Detect every elimination-candidate account per administration + its decision. */
export async function listEliminationAccounts(input: {
  workspaceId: string;
  groupId: string | null;
  from: string;
  to: string;
  currency: string;
  refresh?: boolean;
}): Promise<ElimAccountsResult> {
  const { workspaceId, from, to, currency } = input;
  const groupId = input.groupId ?? null;
  const force = input.refresh ?? false;
  const warnings: string[] = [];
  let lastFetchedAt: Date | null = null;

  const entities = await prisma.entity.findMany({
    where: groupId ? { groupId, group: { workspaceId } } : { group: { workspaceId } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const cand: Candidate[] = entities.map((e) => ({ id: e.id, n: normName(e.name) }));

  const overrideRows = await prisma.eliminationAccountMapping.findMany({
    where: { workspaceId, entityId: { in: entities.map((e) => e.id) } },
    select: { entityId: true, glAccountCode: true, eliminate: true, counterpartyEntityId: true },
  });
  const inScope = new Set(entities.map((e) => e.id));
  const overrides = new Map<string, { eliminate: boolean; counterpartyEntityId: string | null }>();
  for (const r of overrideRows) overrides.set(`${r.entityId}|${r.glAccountCode}`, { eliminate: r.eliminate, counterpartyEntityId: r.counterpartyEntityId });

  const rows: ElimAccountRow[] = [];
  for (const ent of entities) {
    const connector = await tryGetConnectorForEntity(ent.id);
    if (!connector) continue;
    let tb;
    try {
      const tbRes = await cachedTrialBalance(ent.id, { from, to }, force);
      tb = await applyRgsMappings(tbRes.data, workspaceId, ent.id);
      if (!lastFetchedAt || tbRes.fetchedAt > lastFetchedAt) lastFetchedAt = tbRes.fetchedAt;
    } catch (e) {
      warnings.push(`${ent.name}: proefbalans kon niet worden opgehaald (${e instanceof Error ? e.message : "fout"}).`);
      continue;
    }
    await prefetchRates(tb.map((l) => ({ date: to, from: (l.currency || currency).toUpperCase() })), currency);

    for (const l of tb) {
      const category = classifyElimAccount(l.glAccountName, l.rgsCode ?? null, l.rgsGroupCode ?? null);
      if (!category) continue;
      const balance = (await convert(l.balance, (l.currency || currency).toUpperCase(), currency, to)) ?? l.balance;
      const auto = autoDecide(ent.id, l.glAccountName, cand);
      const ov = overrides.get(`${ent.id}|${l.glAccountCode}`);
      const overrideCp = ov ? (ov.counterpartyEntityId && inScope.has(ov.counterpartyEntityId) ? ov.counterpartyEntityId : null) : null;
      rows.push({
        entityId: ent.id,
        entityName: ent.name,
        glAccountCode: l.glAccountCode,
        glAccountName: l.glAccountName,
        rgsCode: l.rgsCode ?? null,
        category,
        categoryLabel: ELIM_CATEGORY_LABEL[category],
        balance,
        autoEliminate: auto.eliminate,
        autoCounterpartyId: auto.counterpartyId,
        overrideEliminate: ov ? ov.eliminate : null,
        overrideCounterpartyId: overrideCp,
        effectiveEliminate: ov ? ov.eliminate : auto.eliminate,
        effectiveCounterpartyId: ov ? overrideCp : auto.counterpartyId,
        source: ov ? "manual" : "auto",
      });
    }
  }
  rows.sort((a, b) => a.entityName.localeCompare(b.entityName) || a.category.localeCompare(b.category) || a.glAccountCode.localeCompare(b.glAccountCode));

  return {
    entities: entities.map((e) => ({ id: e.id, name: e.name })),
    rows,
    cachedAt: lastFetchedAt ? lastFetchedAt.toISOString() : null,
    warnings,
  };
}

// ---- Mutations -------------------------------------------------------------

/** Set or clear (reset to auto) the override for one account. */
export async function setEliminationMapping(input: {
  workspaceId: string;
  entityId: string;
  glAccountCode: string;
  glAccountName: string | null;
  /** null = remove the override (back to auto-detection). */
  eliminate: boolean | null;
  counterpartyEntityId: string | null;
  category: string | null;
  userId: string | null;
}): Promise<{ ok: true }> {
  const { workspaceId, entityId, glAccountCode } = input;
  const ent = await prisma.entity.findFirst({ where: { id: entityId, group: { workspaceId } }, select: { id: true } });
  if (!ent) throw new Error("Administratie niet in deze werkruimte");

  if (input.eliminate === null) {
    await prisma.eliminationAccountMapping.deleteMany({ where: { entityId, glAccountCode } });
    return { ok: true };
  }

  let cp: string | null = null;
  if (input.counterpartyEntityId) {
    if (input.counterpartyEntityId === entityId) throw new Error("Een rekening kan niet naar de eigen administratie elimineren");
    const found = await prisma.entity.findFirst({ where: { id: input.counterpartyEntityId, group: { workspaceId } }, select: { id: true } });
    if (!found) throw new Error("Tegenpartij-administratie niet in deze werkruimte");
    cp = input.counterpartyEntityId;
  }

  await prisma.eliminationAccountMapping.upsert({
    where: { entityId_glAccountCode: { entityId, glAccountCode } },
    create: {
      workspaceId,
      entityId,
      glAccountCode,
      glAccountName: input.glAccountName,
      eliminate: input.eliminate,
      counterpartyEntityId: cp,
      category: input.category,
      createdByUserId: input.userId,
    },
    update: { eliminate: input.eliminate, counterpartyEntityId: cp, category: input.category, glAccountName: input.glAccountName },
  });
  return { ok: true };
}

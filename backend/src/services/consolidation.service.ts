import { prisma } from "../config/prisma.js";
import { tryGetConnectorForEntity } from "../clients/connectors/registry.js";
import type { Connector, TrialBalanceLine } from "../clients/connectors/interfaces/Connector.js";
import { applyRgsMappings, resolveRgsVersion } from "./rgs-mapping.service.js";
import { getIntercompanyRelations, normName, type IcRel } from "./intercompany.service.js";
import { getAdjustmentLeaves } from "./consolidation-adjustment.service.js";
import { convert, prefetchRates } from "./fx.service.js";

/**
 * Consolidation (RGS-B). Aggregates the trial balances of every administration
 * in a scope (a group, or the whole workspace) into ONE consolidated set of
 * figures, using the RGS code as the common key across administrations and a
 * single reporting currency (FX-converted at period end).
 *
 * RGS is the join: each entity's own source accounts differ, but every mapped
 * account resolves to the same RGS leaf — so "the same account" can be summed
 * across entities. Unmapped accounts cannot be aligned and are kept per-entity
 * under a "niet gekoppeld" bucket (and reported as a warning) so totals stay
 * complete and the mapping gap is visible.
 *
 * This is pure aggregation. Intercompany elimination is a follow-up step
 * (RGS-B / Fase 7); every line here carries isElimination=false.
 */

export interface ConsolidationInput {
  workspaceId: string;
  /** Narrow to one consolidation group; null/undefined = the whole workspace. */
  groupId?: string | null;
  from: string;
  to: string;
  /** Reporting currency for all amounts/subtotals. */
  currency: string;
  /** Also compute intercompany elimination entries + imbalance warnings. */
  eliminate?: boolean;
}

export interface ConsolEntityStatus {
  entityId: string;
  entityName: string;
  groupId: string;
  included: boolean;
  /** Why an entity was left out (no connection, fetch error, no mappings…). */
  reason?: string;
}

/** One consolidated leaf line, keyed by RGS code (or per-entity when unmapped). */
export interface ConsolLeafRow {
  statement: "PNL" | "BALANCE";
  /** RGS hoofdrubriek (level-2) code, e.g. "BVor", "WPer", or "zzzz" when unmapped. */
  rgsGroupCode: string;
  rgsGroupName: string;
  rgsGroupDc: string | null;
  rgsGroupOrder: string | null;
  /** RGS leaf code, or a synthetic key for unmapped accounts. */
  key: string;
  rgsCode: string | null;
  description: string;
  unmapped: boolean;
  /** True for synthetic intercompany-elimination lines. */
  isElimination?: boolean;
  /** True for manual consolidation-correction lines. */
  isAdjustment?: boolean;
  /** Consolidated balance (debit − credit) in reporting currency. */
  total: number;
  /** Per-entity contribution to this line, in reporting currency. */
  byEntity: { entityId: string; entityName: string; amount: number }[];
}

/** A mismatch between two administrations' mutual intercompany balances. */
export interface ImbalanceWarning {
  fromEntityId: string;
  fromEntityName: string;
  toEntityId: string;
  toEntityName: string;
  /** `from`'s receivable on `to`. */
  receivable: number;
  /** `to`'s payable to `from`. */
  payable: number;
  diff: number;
}

export interface ConsolidationResult {
  from: string;
  to: string;
  currency: string;
  rgsVersion: string;
  rgsEnabled: boolean;
  groupId: string | null;
  groupName: string | null;
  /** All candidate entities + whether they made it into the consolidation. */
  entities: ConsolEntityStatus[];
  includedEntities: { id: string; name: string }[];
  /** Account/leaf-level consolidated lines (RGS-keyed). */
  leaves: ConsolLeafRow[];
  /** Intercompany elimination lines (empty unless `eliminate` was requested). */
  eliminations: ConsolLeafRow[];
  /** Manual consolidation-correction lines effective in the period. */
  adjustments: ConsolLeafRow[];
  /** Mutual balances that don't reconcile between two administrations. */
  imbalances: ImbalanceWarning[];
  /** Whether any intercompany relations are configured for this scope. */
  intercompanyConfigured: boolean;
  warnings: string[];
}

const groupCodeOf = (c: string) => (c.length >= 4 ? c.slice(0, 4) : c);

/** Run the consolidation for a scope and return the RGS-keyed leaf lines. */
export async function consolidate(input: ConsolidationInput): Promise<ConsolidationResult> {
  const { workspaceId, from, to, currency } = input;
  const groupId = input.groupId ?? null;
  const warnings: string[] = [];

  const settings = await prisma.workspaceSettings.findUnique({ where: { workspaceId } });
  const rgsEnabled = settings?.rgsEnabled ?? false;
  const rgsVersion = await resolveRgsVersion(workspaceId);

  const group = groupId
    ? await prisma.group.findFirst({ where: { id: groupId, workspaceId }, select: { name: true } })
    : null;

  const entities = await prisma.entity.findMany({
    where: groupId ? { groupId, group: { workspaceId } } : { group: { workspaceId } },
    select: { id: true, name: true, groupId: true },
    orderBy: { name: "asc" },
  });

  if (!rgsEnabled) {
    warnings.push(
      "RGS is niet ingeschakeld voor deze werkruimte. Consolidatie vereist RGS-koppeling om rekeningen over administraties heen op één lijn te brengen (Instellingen → RGS / normalisatie).",
    );
  }

  // Fetch + normalize every entity's trial balance concurrently. A failure for
  // one entity (no connection, connector error) excludes only that entity.
  const status: ConsolEntityStatus[] = [];
  const perEntityLines = await Promise.all(
    entities.map(async (ent) => {
      const connector = await tryGetConnectorForEntity(ent.id);
      if (!connector) {
        status.push({ entityId: ent.id, entityName: ent.name, groupId: ent.groupId, included: false, reason: "Geen koppeling" });
        return null;
      }
      try {
        const tb = await connector.getTrialBalance({ from, to });
        const lines = await applyRgsMappings(tb, workspaceId, ent.id);
        status.push({ entityId: ent.id, entityName: ent.name, groupId: ent.groupId, included: true });
        return { ent, lines, connector };
      } catch (e) {
        status.push({
          entityId: ent.id,
          entityName: ent.name,
          groupId: ent.groupId,
          included: false,
          reason: e instanceof Error ? e.message : "Ophalen mislukt",
        });
        return null;
      }
    }),
  );
  const loaded = perEntityLines.filter((x): x is NonNullable<typeof x> => x !== null);

  // One FX prefetch for every (currency → reporting) pair at period end.
  await prefetchRates(
    loaded.flatMap((e) => e.lines.map((l) => ({ date: to, from: (l.currency || currency).toUpperCase() }))),
    currency,
  );

  // Aggregate by RGS leaf across entities; bucket unmapped per-entity so totals stay whole.
  const byKey = new Map<string, ConsolLeafRow>();
  let unmappedCount = 0;

  for (const { ent, lines } of loaded) {
    for (const l of lines) {
      const fromCur = (l.currency || currency).toUpperCase();
      const conv = await convert(l.balance, fromCur, currency, to);
      const amount = conv ?? l.balance; // fall back to raw when no rate (warn below)
      if (conv == null && fromCur !== currency) {
        warnings.push(`Geen wisselkoers voor ${fromCur}→${currency} op ${to}; ${ent.name} telt onomgerekend mee.`);
      }
      const statement: "PNL" | "BALANCE" = l.accountType === "PROFIT_LOSS" ? "PNL" : "BALANCE";
      const isUnmapped = !l.rgsCode;
      if (isUnmapped) unmappedCount += 1;

      const key = isUnmapped ? `U:${ent.id}:${l.glAccountCode}` : `R:${l.rgsCode}`;
      const gc = isUnmapped ? "zzzz" : l.rgsGroupCode || groupCodeOf(l.rgsCode!);
      const row =
        byKey.get(key) ??
        ({
          statement,
          rgsGroupCode: gc,
          rgsGroupName: isUnmapped ? "Niet aan RGS gekoppeld" : l.rgsGroupName || gc,
          rgsGroupDc: l.rgsGroupDc ?? null,
          rgsGroupOrder: l.rgsGroupOrder ?? null,
          key,
          rgsCode: l.rgsCode ?? null,
          description: isUnmapped ? `${l.glAccountName} (${ent.name})` : l.rgsGroupName || l.glAccountName,
          unmapped: isUnmapped,
          total: 0,
          byEntity: [],
        } as ConsolLeafRow);
      row.total += amount;
      const be = row.byEntity.find((x) => x.entityId === ent.id);
      if (be) be.amount += amount;
      else row.byEntity.push({ entityId: ent.id, entityName: ent.name, amount });
      byKey.set(key, row);
    }
  }

  // Enrich mapped-leaf descriptions from the RGS taxonomy (nicer than the group name).
  const leafCodes = [...new Set([...byKey.values()].map((r) => r.rgsCode).filter((c): c is string => !!c))];
  if (leafCodes.length) {
    const rgs = await prisma.rgsAccount.findMany({
      where: { version: rgsVersion, code: { in: leafCodes } },
      select: { code: true, description: true },
    });
    const desc = new Map(rgs.map((r) => [r.code, r.description]));
    for (const r of byKey.values()) if (r.rgsCode && desc.has(r.rgsCode)) r.description = desc.get(r.rgsCode)!;
  }

  if (unmappedCount > 0) {
    warnings.push(`${unmappedCount} rekening(en) zijn nog niet aan RGS gekoppeld en konden niet geconsolideerd worden.`);
  }
  if (loaded.length === 0) {
    warnings.push("Geen enkele administratie in deze scope kon worden geladen.");
  }

  // Intercompany elimination (optional): net out mutual balances per account.
  const entityIds = loaded.map((e) => e.ent.id);
  const icRels = await getIntercompanyRelations(entityIds);
  const intercompanyConfigured = [...icRels.values()].some((a) => a.length > 0);
  let eliminations: ConsolLeafRow[] = [];
  let imbalances: ImbalanceWarning[] = [];
  if (input.eliminate && intercompanyConfigured) {
    const elim = await computeEliminations(loaded, icRels, workspaceId, currency, from, to, warnings);
    eliminations = elim.eliminations;
    imbalances = elim.imbalances;
  }

  // Manual consolidation corrections effective in this period (always applied).
  const adjustments = await getAdjustmentLeaves(workspaceId, groupId, from, to, currency);

  return {
    from,
    to,
    currency,
    rgsVersion,
    rgsEnabled,
    groupId,
    groupName: group?.name ?? null,
    entities: status.sort((a, b) => a.entityName.localeCompare(b.entityName)),
    includedEntities: loaded.map((e) => ({ id: e.ent.id, name: e.ent.name })),
    leaves: [...byKey.values()],
    eliminations,
    adjustments,
    imbalances,
    intercompanyConfigured,
    warnings: [...new Set(warnings)],
  };
}

type LoadedEntity = { ent: { id: string; name: string; groupId: string }; lines: TrialBalanceLine[]; connector: Connector };

interface AccountMeta {
  balance: number; // reporting currency, debit − credit
  name: string;
  rgsCode: string | null;
  rgsGroupCode: string;
  rgsGroupName: string;
  rgsGroupDc: string | null;
  rgsGroupOrder: string | null;
  statement: "PNL" | "BALANCE";
}

/** RGS codes that are intercompany by definition (vorderingen/schulden op
 *  groepsmaatschappijen, rekening-courant groepsmij). For these the whole
 *  closing balance is intercompany, so the full leaf balance is eliminated. */
export const isIntragroupCode = (rgs: string | null): boolean =>
  !!rgs && (rgs.startsWith("BVorVog") || rgs.startsWith("BSchSag") || rgs.startsWith("BSchScg"));

/**
 * Build intercompany elimination lines + imbalance warnings from each entity's
 * transactions tagged with a counterparty relation. The relation mapping marks
 * which contactName is another administration; postings carrying it are
 * intercompany. For dedicated intragroup accounts (RGS BVorVog/BSchSag) the full
 * closing balance is eliminated; otherwise the intercompany flow in the period.
 * Eliminations are keyed to the same RGS leaf as the gross figure, so they show
 * on the exact grootboekrekening. A mismatch between two administrations' mutual
 * balance-sheet positions is flagged as an imbalance.
 */
async function computeEliminations(
  loaded: LoadedEntity[],
  icRels: Map<string, IcRel[]>,
  workspaceId: string,
  currency: string,
  from: string,
  to: string,
  warnings: string[],
): Promise<{ eliminations: ConsolLeafRow[]; imbalances: ImbalanceWarning[] }> {
  const nameById = new Map(loaded.map((e) => [e.ent.id, e.ent.name]));

  // Per-entity, per-account closing balance (reporting currency) + RGS metadata.
  const balByEntity = new Map<string, Map<string, AccountMeta>>();
  for (const { ent, lines } of loaded) {
    const m = new Map<string, AccountMeta>();
    for (const l of lines) {
      const conv = await convert(l.balance, (l.currency || currency).toUpperCase(), currency, to);
      m.set(l.glAccountCode, {
        balance: conv ?? l.balance,
        name: l.glAccountName,
        rgsCode: l.rgsCode ?? null,
        rgsGroupCode: l.rgsGroupCode || (l.rgsCode ? l.rgsCode.slice(0, 4) : "zzzz"),
        rgsGroupName: l.rgsGroupName || "Niet aan RGS gekoppeld",
        rgsGroupDc: l.rgsGroupDc ?? null,
        rgsGroupOrder: l.rgsGroupOrder ?? null,
        statement: l.accountType === "PROFIT_LOSS" ? "PNL" : "BALANCE",
      });
    }
    balByEntity.set(ent.id, m);
  }

  const elimByKey = new Map<string, ConsolLeafRow>();
  // Balance-sheet net position per (entity, counterparty) for the imbalance check.
  const netBS = new Map<string, Map<string, number>>();
  const bumpNet = (a: string, b: string, v: number) => {
    const inner = netBS.get(a) ?? new Map<string, number>();
    inner.set(b, (inner.get(b) ?? 0) + v);
    netBS.set(a, inner);
  };

  for (const { ent, connector } of loaded) {
    const rels = icRels.get(ent.id);
    if (!rels || rels.length === 0) continue;
    const nameToCp = new Map<string, string>();
    for (const r of rels) if (r.relationName) nameToCp.set(normName(r.relationName), r.counterpartyEntityId);

    let txns;
    try {
      txns = await applyRgsMappings(await connector.getTransactions({ from, to }), workspaceId, ent.id);
    } catch (e) {
      warnings.push(`${ent.name}: transacties voor eliminatie konden niet worden opgehaald (${e instanceof Error ? e.message : "fout"}).`);
      continue;
    }
    await prefetchRates(txns.map((t) => ({ date: t.date, from: (t.currency || currency).toUpperCase() })), currency);

    // Per account: intercompany flow, whether any external contact appears, and the dominant counterparty.
    const perAcct = new Map<string, { ic: number; external: boolean; cpAmt: Map<string, number> }>();
    for (const t of txns) {
      const conv = await convert(t.amount, (t.currency || currency).toUpperCase(), currency, t.date);
      const amt = conv ?? t.amount;
      const a = perAcct.get(t.glAccountCode) ?? { ic: 0, external: false, cpAmt: new Map<string, number>() };
      const cp = t.contactName ? nameToCp.get(normName(t.contactName)) : undefined;
      if (cp) {
        a.ic += amt;
        a.cpAmt.set(cp, (a.cpAmt.get(cp) ?? 0) + amt);
      } else if (t.contactName) {
        a.external = true;
      }
      perAcct.set(t.glAccountCode, a);
    }

    const bal = balByEntity.get(ent.id);
    for (const [acct, agg] of perAcct) {
      if (Math.abs(agg.ic) < 0.005) continue;
      const meta = bal?.get(acct);
      // Dominant counterparty on this account.
      let cp = "";
      let best = 0;
      for (const [c, v] of agg.cpAmt) if (Math.abs(v) > Math.abs(best)) ((best = v), (cp = c));
      // Dedicated intragroup accounts → eliminate the full closing balance;
      // mixed accounts → eliminate only the intercompany flow in the period.
      const eliminateFull = meta ? isIntragroupCode(meta.rgsCode) : false;
      const elimAmount = eliminateFull && meta ? -meta.balance : -agg.ic;
      if (Math.abs(elimAmount) < 0.005) continue;

      const statement = meta?.statement ?? "BALANCE";
      const key = meta?.rgsCode ? `R:${meta.rgsCode}` : `U:${ent.id}:${acct}`;
      const row =
        elimByKey.get(key) ??
        ({
          statement,
          rgsGroupCode: meta?.rgsGroupCode ?? "zzzz",
          rgsGroupName: meta?.rgsGroupName ?? "Niet aan RGS gekoppeld",
          rgsGroupDc: meta?.rgsGroupDc ?? null,
          rgsGroupOrder: meta?.rgsGroupOrder ?? null,
          key,
          rgsCode: meta?.rgsCode ?? null,
          description: `Eliminatie — ${meta?.name ?? acct}`,
          unmapped: !meta?.rgsCode,
          isElimination: true,
          total: 0,
          byEntity: [],
        } as ConsolLeafRow);
      row.total += elimAmount;
      const be = row.byEntity.find((x) => x.entityId === ent.id);
      if (be) be.amount += elimAmount;
      else row.byEntity.push({ entityId: ent.id, entityName: ent.name, amount: elimAmount });
      elimByKey.set(key, row);

      if (statement === "BALANCE" && cp) bumpNet(ent.id, cp, elimAmount);
    }
  }

  const eliminations = [...elimByKey.values()].filter((r) => Math.abs(r.total) > 0.005);

  // Imbalance: A's eliminated balance-sheet position with B should cancel B's with A.
  const imbalances: ImbalanceWarning[] = [];
  const seen = new Set<string>();
  for (const [a, inner] of netBS) {
    for (const [b, va] of inner) {
      const pairKey = [a, b].sort().join("|");
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      const vb = netBS.get(b)?.get(a) ?? 0;
      const diff = va + vb;
      if (Math.abs(diff) > 0.01) {
        imbalances.push({
          fromEntityId: a,
          fromEntityName: nameById.get(a) ?? a,
          toEntityId: b,
          toEntityName: nameById.get(b) ?? b,
          receivable: -va,
          payable: -vb,
          diff,
        });
      }
    }
  }
  return { eliminations, imbalances };
}

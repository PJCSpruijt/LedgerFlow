import { prisma } from "../config/prisma.js";
import { tryGetConnectorForEntity } from "../clients/connectors/registry.js";
import type { Connector } from "../clients/connectors/interfaces/Connector.js";
import { applyRgsMappings, resolveRgsVersion } from "./rgs-mapping.service.js";
import { getIntercompanyMap } from "./intercompany.service.js";
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

  // Intercompany elimination (optional): net out mutual receivables/payables.
  const entityIds = loaded.map((e) => e.ent.id);
  const icMap = await getIntercompanyMap(entityIds);
  const intercompanyConfigured = [...icMap.values()].some((m) => m.size > 0);
  let eliminations: ConsolLeafRow[] = [];
  let imbalances: ImbalanceWarning[] = [];
  if (input.eliminate && intercompanyConfigured) {
    const elim = await computeEliminations(
      loaded.map((e) => ({ id: e.ent.id, name: e.ent.name, connector: e.connector })),
      icMap,
      currency,
      rgsVersion,
      warnings,
    );
    eliminations = elim.eliminations;
    imbalances = elim.imbalances;
  }

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
    imbalances,
    intercompanyConfigured,
    warnings: [...new Set(warnings)],
  };
}

/**
 * Build intercompany elimination lines + imbalance warnings from each entity's
 * open receivables/payables per relation. A relation mapped to a counterparty
 * entity is intercompany: its open receivable in A should equal the open payable
 * in B. Eliminations remove both legs; a mismatch is flagged as an imbalance.
 */
async function computeEliminations(
  entities: { id: string; name: string; connector: Connector }[],
  icMap: Map<string, Map<string, string>>,
  currency: string,
  rgsVersion: string,
  warnings: string[],
): Promise<{ eliminations: ConsolLeafRow[]; imbalances: ImbalanceWarning[] }> {
  const nameById = new Map(entities.map((e) => [e.id, e.name]));
  // recv[a][b] = a's open receivable attributed to counterparty b. pay[a][b] = a's payable to b.
  const recv = new Map<string, Map<string, number>>();
  const pay = new Map<string, Map<string, number>>();
  const bump = (m: Map<string, Map<string, number>>, a: string, b: string, v: number) => {
    const inner = m.get(a) ?? new Map<string, number>();
    inner.set(b, (inner.get(b) ?? 0) + v);
    m.set(a, inner);
  };

  for (const e of entities) {
    const mapped = icMap.get(e.id);
    if (!mapped || mapped.size === 0) continue;
    try {
      const [deb, cre] = await Promise.all([e.connector.getOutstanding("debtor"), e.connector.getOutstanding("creditor")]);
      for (const it of deb) {
        const cp = mapped.get(it.relationId);
        if (cp) bump(recv, e.id, cp, it.openAmount);
      }
      for (const it of cre) {
        const cp = mapped.get(it.relationId);
        if (cp) bump(pay, e.id, cp, it.openAmount);
      }
    } catch (err) {
      warnings.push(`${e.name}: openstaande posten voor eliminatie konden niet worden opgehaald (${err instanceof Error ? err.message : "fout"}).`);
    }
  }

  // RGS hoofdrubriek metadata for the elimination buckets.
  const rgs = await prisma.rgsAccount.findMany({
    where: { version: rgsVersion, code: { in: ["BVor", "BSch"] } },
    select: { code: true, description: true, referentienummer: true, dc: true },
  });
  const meta = new Map(rgs.map((r) => [r.code, r]));
  const vorName = meta.get("BVor")?.description ?? "Vorderingen";
  const schName = meta.get("BSch")?.description ?? "Kortlopende schulden";

  // Aggregate elimination amounts per entity for the two buckets.
  const recvByEntity: { entityId: string; entityName: string; amount: number }[] = [];
  const payByEntity: { entityId: string; entityName: string; amount: number }[] = [];
  let recvTotal = 0;
  let payTotal = 0;
  for (const [a, inner] of recv) {
    const amt = [...inner.values()].reduce((s, v) => s + v, 0);
    if (Math.abs(amt) < 0.005) continue;
    recvByEntity.push({ entityId: a, entityName: nameById.get(a) ?? a, amount: -amt }); // remove the receivable (debit) → negative
    recvTotal += -amt;
  }
  for (const [a, inner] of pay) {
    const amt = [...inner.values()].reduce((s, v) => s + v, 0);
    if (Math.abs(amt) < 0.005) continue;
    payByEntity.push({ entityId: a, entityName: nameById.get(a) ?? a, amount: amt }); // remove the payable (credit) → positive
    payTotal += amt;
  }

  const eliminations: ConsolLeafRow[] = [];
  if (recvByEntity.length) {
    eliminations.push({
      statement: "BALANCE",
      rgsGroupCode: "BVor",
      rgsGroupName: vorName,
      rgsGroupDc: meta.get("BVor")?.dc ?? "D",
      rgsGroupOrder: meta.get("BVor")?.referentienummer ?? null,
      key: "ELIM:RECV",
      rgsCode: null,
      description: "Eliminatie intercompany-vorderingen",
      unmapped: false,
      isElimination: true,
      total: recvTotal,
      byEntity: recvByEntity,
    });
  }
  if (payByEntity.length) {
    eliminations.push({
      statement: "BALANCE",
      rgsGroupCode: "BSch",
      rgsGroupName: schName,
      rgsGroupDc: meta.get("BSch")?.dc ?? "C",
      rgsGroupOrder: meta.get("BSch")?.referentienummer ?? null,
      key: "ELIM:PAY",
      rgsCode: null,
      description: "Eliminatie intercompany-schulden",
      unmapped: false,
      isElimination: true,
      total: payTotal,
      byEntity: payByEntity,
    });
  }

  // Imbalance check per ordered pair: a's receivable on b vs b's payable to a.
  const imbalances: ImbalanceWarning[] = [];
  for (const a of entities) {
    for (const b of entities) {
      if (a.id === b.id) continue;
      const r = recv.get(a.id)?.get(b.id) ?? 0;
      const p = pay.get(b.id)?.get(a.id) ?? 0;
      if (Math.abs(r) < 0.005 && Math.abs(p) < 0.005) continue;
      const diff = r - p;
      if (Math.abs(diff) > 0.01) {
        imbalances.push({
          fromEntityId: a.id,
          fromEntityName: a.name,
          toEntityId: b.id,
          toEntityName: b.name,
          receivable: r,
          payable: p,
          diff,
        });
      }
    }
  }
  return { eliminations, imbalances };
}

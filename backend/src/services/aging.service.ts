import { prisma } from "../config/prisma.js";
import { tryGetConnectorForEntity } from "../clients/connectors/registry.js";
import { applyRgsMappings } from "./rgs-mapping.service.js";
import { cachedTrialBalance, cachedTransactions, cachedOutstanding } from "./connector-cache.service.js";
import { getIntercompanyRelations, normName } from "./intercompany.service.js";
import { convert, prefetchRates } from "./fx.service.js";
import { isRateLimitError } from "../utils/errors.js";

/**
 * Consolidated receivables/payables AGING report across a scope (group or whole
 * workspace), in one reporting currency. Buckets each open item by how long it
 * is overdue (relative to the as-of date), per relation and per administration.
 * Intercompany relations are flagged so they can be excluded. Adds period-based
 * DSO/DPO from the same window's revenue/cost.
 *
 * Trend over time needs stored aging snapshots and is a documented follow-up.
 */

export type Bucket = "current" | "d30" | "d60" | "d90" | "d90p";
export const BUCKET_KEYS: Bucket[] = ["current", "d30", "d60", "d90", "d90p"];
export const BUCKET_LABELS: Record<Bucket, string> = {
  current: "Niet vervallen",
  d30: "1–30",
  d60: "31–60",
  d90: "61–90",
  d90p: "> 90",
};

export type Buckets = Record<Bucket, number>;
const emptyBuckets = (): Buckets => ({ current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 });
const bucketOf = (age: number): Bucket => (age <= 0 ? "current" : age <= 30 ? "d30" : age <= 60 ? "d60" : age <= 90 ? "d90" : "d90p");

export interface AgingRelationRow {
  relationName: string;
  intercompany: boolean;
  total: number;
  buckets: Buckets;
  byEntity: { entityId: string; entityName: string; amount: number }[];
}
export interface AgingSide {
  rows: AgingRelationRow[];
  totals: Buckets;
  grandTotal: number;
  intercompanyTotal: number;
}
export interface AgingResult {
  from: string;
  to: string;
  asOf: string;
  currency: string;
  entities: { id: string; name: string; included: boolean; reason?: string; rateLimited?: boolean }[];
  debtors: AgingSide;
  creditors: AgingSide;
  dso: number | null;
  dpo: number | null;
  revenue: number;
  cost: number;
  periodDays: number;
  cachedAt: string | null;
  warnings: string[];
}

export interface AgingInput {
  workspaceId: string;
  groupId?: string | null;
  from: string;
  to: string;
  currency: string;
  refresh?: boolean;
}

const REV_NAME = /omzet|opbrengst|revenue|sales|turnover/i;
const COST_NAME = /inkoop|kostprijs|kosten|cost|management\s?fee|licen|recharge|doorbelast/i;

const daysBetween = (from: string, to: string): number => {
  const a = new Date(`${from}T00:00:00`).getTime();
  const b = new Date(`${to}T00:00:00`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
};

export async function computeAging(input: AgingInput): Promise<AgingResult> {
  const { workspaceId, from, to, currency } = input;
  const groupId = input.groupId ?? null;
  const force = input.refresh ?? false;
  const warnings: string[] = [];
  const asOf = new Date(`${to}T00:00:00`).getTime();
  const periodDays = daysBetween(from, to);

  const entities = await prisma.entity.findMany({
    where: groupId ? { groupId, group: { workspaceId } } : { group: { workspaceId } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const entityIds = entities.map((e) => e.id);
  const icRels = await getIntercompanyRelations(entityIds);

  // Aggregators keyed by normalized relation name.
  type Agg = { name: string; intercompany: boolean; total: number; buckets: Buckets; byEntity: Map<string, number> };
  const debMap = new Map<string, Agg>();
  const creMap = new Map<string, Agg>();
  let revenue = 0;
  let cost = 0;
  const fetched: { at: Date | null } = { at: null };
  const status: AgingResult["entities"] = [];

  const ageOf = (date: string, dueDate: string | null): number => {
    const ref = dueDate || date;
    const t = new Date(`${ref}T00:00:00`).getTime();
    if (Number.isNaN(t)) return 0;
    return Math.floor((asOf - t) / 86_400_000);
  };

  await Promise.all(
    entities.map(async (ent) => {
      const connector = await tryGetConnectorForEntity(ent.id);
      if (!connector) {
        status.push({ id: ent.id, name: ent.name, included: false, reason: "Geen koppeling" });
        return;
      }
      let tb, deb, cre, txns;
      try {
        const [tbRes, debRes, creRes, txRes] = await Promise.all([
          cachedTrialBalance(ent.id, { from, to }, force),
          cachedOutstanding(ent.id, "debtor", force),
          cachedOutstanding(ent.id, "creditor", force),
          cachedTransactions(ent.id, { from, to }, force),
        ]);
        tb = tbRes.data;
        deb = debRes.data;
        cre = creRes.data;
        txns = await applyRgsMappings(txRes.data, workspaceId, ent.id);
        for (const r of [tbRes, debRes, creRes, txRes]) if (!fetched.at || r.fetchedAt > fetched.at) fetched.at = r.fetchedAt;
      } catch (e) {
        status.push({ id: ent.id, name: ent.name, included: false, reason: e instanceof Error ? e.message : "Ophalen mislukt", rateLimited: isRateLimitError(e) });
        return;
      }
      status.push({ id: ent.id, name: ent.name, included: true });

      // Functional currency for converting the (currency-less) open items.
      const entityCurrency = (tb.find((l) => l.currency)?.currency || "EUR").toUpperCase();
      await prefetchRates(
        [{ date: to, from: entityCurrency }, ...txns.map((t) => ({ date: t.date, from: (t.currency || currency).toUpperCase() }))],
        currency,
      );
      const toReporting = async (amount: number, date: string, cur?: string | null) =>
        (await convert(amount, (cur || entityCurrency).toUpperCase(), currency, date)) ?? amount;

      // Intercompany relation ids for this entity.
      const icIds = new Set((icRels.get(ent.id) ?? []).map((r) => r.relationId));

      const add = (map: Map<string, Agg>, name: string, relationId: string, amount: number, age: number) => {
        const key = normName(name) || name.toLowerCase();
        const a = map.get(key) ?? { name, intercompany: false, total: 0, buckets: emptyBuckets(), byEntity: new Map() };
        a.total += amount;
        a.buckets[bucketOf(age)] += amount;
        a.byEntity.set(ent.id, (a.byEntity.get(ent.id) ?? 0) + amount);
        if (icIds.has(relationId)) a.intercompany = true;
        map.set(key, a);
      };

      for (const it of deb ?? []) {
        const amt = await toReporting(it.openAmount, to);
        if (Math.abs(amt) < 0.005) continue;
        add(debMap, it.relationName || "(onbekend)", it.relationId, amt, ageOf(it.date, it.dueDate));
      }
      for (const it of cre ?? []) {
        const amt = await toReporting(it.openAmount, to);
        if (Math.abs(amt) < 0.005) continue;
        add(creMap, it.relationName || "(onbekend)", it.relationId, amt, ageOf(it.date, it.dueDate));
      }

      // Period revenue/cost for DSO/DPO (signed amount: credit negative).
      for (const t of txns) {
        const amt = await toReporting(t.amount, t.date, t.currency);
        const grp = t.rgsGroupCode ?? "";
        if (t.accountType === "PROFIT_LOSS" && (grp.startsWith("WOmz") || REV_NAME.test(t.glAccountName))) revenue += -amt;
        else if (t.accountType === "PROFIT_LOSS" && (grp.startsWith("WKpr") || grp.startsWith("WKos") || COST_NAME.test(t.glAccountName))) cost += amt;
      }
    }),
  );

  const buildSide = (map: Map<string, Agg>): AgingSide => {
    const rows: AgingRelationRow[] = [...map.values()]
      .filter((a) => Math.abs(a.total) >= 0.005)
      .map((a) => ({
        relationName: a.name,
        intercompany: a.intercompany,
        total: a.total,
        buckets: a.buckets,
        byEntity: [...a.byEntity.entries()].map(([entityId, amount]) => ({
          entityId,
          entityName: entities.find((e) => e.id === entityId)?.name ?? entityId,
          amount,
        })),
      }))
      .sort((x, y) => y.total - x.total);
    const totals = emptyBuckets();
    let grandTotal = 0;
    let intercompanyTotal = 0;
    for (const r of rows) {
      for (const b of BUCKET_KEYS) totals[b] += r.buckets[b];
      grandTotal += r.total;
      if (r.intercompany) intercompanyTotal += r.total;
    }
    return { rows, totals, grandTotal, intercompanyTotal };
  };

  const debtors = buildSide(debMap);
  const creditors = buildSide(creMap);

  if (status.some((s) => s.rateLimited)) {
    warnings.push(`Daglimiet bereikt voor ${status.filter((s) => s.rateLimited).map((s) => s.name).join(", ")}; ouderdomsanalyse tijdelijk onvolledig.`);
  } else if (status.some((s) => !s.included)) {
    warnings.push("Niet alle administraties konden worden geladen.");
  }

  // DSO/DPO: open balance relative to period revenue/cost, scaled to period days.
  const dso = revenue > 0 ? (debtors.grandTotal / revenue) * periodDays : null;
  const dpo = cost > 0 ? (creditors.grandTotal / cost) * periodDays : null;

  return {
    from,
    to,
    asOf: to,
    currency,
    entities: status.sort((a, b) => a.name.localeCompare(b.name)),
    debtors,
    creditors,
    dso: dso != null ? Math.round(dso) : null,
    dpo: dpo != null ? Math.round(dpo) : null,
    revenue,
    cost,
    periodDays,
    cachedAt: fetched.at ? fetched.at.toISOString() : null,
    warnings,
  };
}

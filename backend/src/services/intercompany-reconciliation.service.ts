import { prisma } from "../config/prisma.js";
import { tryGetConnectorForEntity } from "../clients/connectors/registry.js";
import { applyRgsMappings } from "./rgs-mapping.service.js";
import { getIntercompanyRelations, normName } from "./intercompany.service.js";
import { cachedTrialBalance, cachedTransactions, cachedOutstanding } from "./connector-cache.service.js";
import { convert, prefetchRates } from "./fx.service.js";
import { buildEliminationResolver } from "./elimination-mapping.service.js";
import { isRateLimitError } from "../utils/errors.js";

/**
 * Intercompany reconciliation / mismatch engine (consolidation Fase 2).
 *
 * Per counterparty pair and elimination category it lines up both legs and
 * classifies the residual into a typed mismatch — reproducing the manual
 * worksheet's "Waarschuwing" column. It does NOT post anything; it diagnoses
 * what should reconcile and flags what doesn't, per type:
 *   - deelneming ↔ eigen vermogen deelneming
 *   - rekening-courant onderling
 *   - lening onderling
 *   - debiteuren ↔ crediteuren (facturen niet geboekt / timing)
 *   - omzet ↔ kosten (intercompany)
 *
 * Balance-sheet, intragroup-by-nature accounts (RC, lening, deelneming, eigen
 * vermogen) use the closing balance; trade and P&L positions use the
 * intercompany-tagged transaction flow in the period (relation-based).
 */

export type ReconCategory =
  | "EQUITY_INVESTMENT"
  | "CURRENT_ACCOUNT"
  | "LOAN"
  | "RECEIVABLE_PAYABLE"
  | "TAX_FISCAL_UNITY"
  | "REVENUE_COST";

export const CATEGORY_LABEL: Record<ReconCategory, string> = {
  EQUITY_INVESTMENT: "Deelneming ↔ eigen vermogen",
  CURRENT_ACCOUNT: "Rekening-courant",
  LOAN: "Leningen",
  RECEIVABLE_PAYABLE: "Debiteuren ↔ crediteuren",
  TAX_FISCAL_UNITY: "Belasting / fiscale eenheid (btw)",
  REVENUE_COST: "Omzet ↔ kosten",
};

type Side = "INVESTMENT" | "EQUITY" | "RC" | "LOAN" | "RECEIVABLE" | "PAYABLE" | "TAX" | "REVENUE" | "COST";

interface Classified {
  category: ReconCategory;
  side: Side;
  /** Balance-based (closing TB) vs flow-based (IC-tagged transactions). */
  basis: "balance" | "flow";
}

/** Classify a GL account/line into an elimination category (RGS code first, then name). */
function classify(name: string, rgsCode: string | null, rgsGroupCode: string | null, isProfitLoss: boolean): Classified | null {
  const n = name.toLowerCase();
  const rgs = rgsCode ?? "";
  const grp = rgsGroupCode ?? "";

  if (!isProfitLoss) {
    // Rekening-courant (check before deelneming — names overlap on "groepsmaatschappij").
    if (/rekening.?courant/.test(n) || /(^|\s)rc[\s/]/.test(n) || rgs.startsWith("BVorVog") || rgs.startsWith("BSchSag"))
      return { category: "CURRENT_ACCOUNT", side: "RC", basis: "balance" };
    if (/lening/.test(n)) return { category: "LOAN", side: "LOAN", basis: "balance" };
    if (rgs.startsWith("BFvaDig") || /deelneming|groep(s)?maatschapp/.test(n))
      return { category: "EQUITY_INVESTMENT", side: "INVESTMENT", basis: "balance" };
    if (grp === "BEiv" || /aandelenkapitaal|agio|reserve|onverdeeld resultaat|resultaat (lopend|boekjaar|voorgaande)|eigen vermogen|kapitaal/.test(n))
      return { category: "EQUITY_INVESTMENT", side: "EQUITY", basis: "balance" };
    // Btw / fiscale eenheid is een intercompany-afrekening (geen handelspost) → eigen categorie.
    if (/fiscale eenheid/.test(n) || rgs.startsWith("BSchBepBtw") || rgs.startsWith("BVorVbk"))
      return { category: "TAX_FISCAL_UNITY", side: "TAX", basis: "flow" };
    // Handelsdebiteuren/-crediteuren komen NIET hier vandaan maar uit de openstaande
    // posten (zie open-items-pass) — een hele BVor/BSch-hoofdrubriek (incl. btw,
    // overlopend) als debiteur/crediteur bestempelen was onjuist.
    return null;
  }
  // Profit & loss
  if (grp.startsWith("WOmz") || /omzet|opbrengst|revenue|sales|turnover/.test(n))
    return { category: "REVENUE_COST", side: "REVENUE", basis: "flow" };
  if (/inkoop|kostprijs|management\s?fee|licen|recharge|doorbelast|kosten|fee/.test(n))
    return { category: "REVENUE_COST", side: "COST", basis: "flow" };
  return null;
}

interface Position {
  entityId: string;
  entityName: string;
  category: ReconCategory;
  side: Side;
  counterpartyId: string | null;
  accountCode: string;
  accountName: string;
  rgsCode: string | null;
  amount: number; // reporting currency, signed (debit − credit)
}

export interface ReconRow {
  category: ReconCategory;
  categoryLabel: string;
  entityName: string;
  accountCode: string;
  accountName: string;
  rgsCode: string | null;
  side: Side;
  counterpartyName: string | null;
  amount: number;
}

export interface ReconPairResult {
  category: ReconCategory;
  categoryLabel: string;
  aEntityId: string;
  aEntityName: string;
  bEntityId: string;
  bEntityName: string;
  aAmount: number;
  bAmount: number;
  residual: number;
  status: "MATCHED" | "ONE_SIDED" | "MISMATCH";
  warning: string;
}

export interface ReconResult {
  from: string;
  to: string;
  currency: string;
  tolerance: number;
  entities: { id: string; name: string; included: boolean; reason?: string; rateLimited?: boolean }[];
  pairs: ReconPairResult[];
  rows: ReconRow[];
  summary: { matched: number; oneSided: number; mismatched: number };
  cachedAt: string | null;
  warnings: string[];
}

const WARNING: Record<ReconCategory, { mismatch: string; oneSided: (who: string) => string }> = {
  EQUITY_INVESTMENT: {
    mismatch: "Verschil waardering deelneming en eigen vermogen deelneming",
    oneSided: () => "Deelneming of eigen vermogen ontbreekt aan één zijde",
  },
  CURRENT_ACCOUNT: {
    mismatch: "Rekening-courant sluit onderling niet",
    oneSided: (who) => `Rekening-courant niet geboekt bij ${who}`,
  },
  LOAN: { mismatch: "Lening sluit onderling niet", oneSided: (who) => `Lening niet geboekt bij ${who}` },
  RECEIVABLE_PAYABLE: {
    mismatch: "Debiteuren en crediteuren sluiten onderling niet",
    oneSided: (who) => `Facturen niet geboekt bij ${who}`,
  },
  TAX_FISCAL_UNITY: {
    mismatch: "Btw/fiscale-eenheid-afrekening sluit onderling niet",
    oneSided: (who) => `Btw fiscale eenheid niet geboekt bij ${who}`,
  },
  REVENUE_COST: {
    mismatch: "Omzet en kosten sluiten onderling niet",
    oneSided: (who) => `Facturen niet geboekt bij ${who}`,
  },
};

export async function reconcileIntercompany(input: {
  workspaceId: string;
  groupId: string | null;
  from: string;
  to: string;
  currency: string;
  refresh?: boolean;
}): Promise<ReconResult> {
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
  const nameById = new Map(entities.map((e) => [e.id, e.name]));
  const candIds = entities.map((e) => ({ id: e.id, n: normName(e.name) }));
  const icRels = await getIntercompanyRelations(entities.map((e) => e.id));
  // Per-account elimination resolver (Layer 1 auto + Layer 2 manual override):
  // decides whether a deelneming/RC/lening account eliminates and against which
  // in-scope administration. A participation naming a company OUTSIDE the
  // consolidation resolves to "do not eliminate" (counterparty null).
  const elimResolver = await buildEliminationResolver(workspaceId, entities);

  const status: ReconResult["entities"] = [];
  const positions: Position[] = [];

  for (const ent of entities) {
    const connector = await tryGetConnectorForEntity(ent.id);
    if (!connector) {
      status.push({ id: ent.id, name: ent.name, included: false, reason: "Geen koppeling" });
      continue;
    }
    let tb, txns, debOpen, creOpen;
    try {
      const [tbRes, txRes, debRes, creRes] = await Promise.all([
        cachedTrialBalance(ent.id, { from, to }, force),
        cachedTransactions(ent.id, { from, to }, force),
        cachedOutstanding(ent.id, "debtor", force),
        cachedOutstanding(ent.id, "creditor", force),
      ]);
      tb = await applyRgsMappings(tbRes.data, workspaceId, ent.id);
      txns = await applyRgsMappings(txRes.data, workspaceId, ent.id);
      debOpen = debRes.data;
      creOpen = creRes.data;
      for (const r of [tbRes, txRes, debRes, creRes]) if (!lastFetchedAt || r.fetchedAt > lastFetchedAt) lastFetchedAt = r.fetchedAt;
    } catch (e) {
      status.push({ id: ent.id, name: ent.name, included: false, reason: e instanceof Error ? e.message : "Ophalen mislukt", rateLimited: isRateLimitError(e) });
      continue;
    }
    status.push({ id: ent.id, name: ent.name, included: true });

    await prefetchRates(
      [
        ...tb.map((l) => ({ date: to, from: (l.currency || currency).toUpperCase() })),
        ...txns.map((t) => ({ date: t.date, from: (t.currency || currency).toUpperCase() })),
      ],
      currency,
    );

    // Relation name → counterparty for transaction tagging.
    const nameToCp = new Map<string, string>();
    for (const r of icRels.get(ent.id) ?? []) if (r.relationName) nameToCp.set(normName(r.relationName), r.counterpartyEntityId);

    // Balance-sheet intragroup positions (RC / loan / deelneming / equity) at closing balance.
    for (const l of tb) {
      const cls = classify(l.glAccountName, l.rgsCode ?? null, l.rgsGroupCode ?? null, l.accountType === "PROFIT_LOSS");
      if (!cls || cls.basis !== "balance") continue;
      const amt = (await convert(l.balance, (l.currency || currency).toUpperCase(), currency, to)) ?? l.balance;
      if (Math.abs(amt) < 0.005) continue;
      // EQUITY's counterparty is back-filled later (subsidiary equity ↔ parent
      // deelneming). For INVESTMENT/RC/LOAN the resolver decides eliminate +
      // counterparty; a participation outside the consolidation resolves to null
      // (shown, not eliminated).
      let counterpartyId: string | null = null;
      if (cls.side !== "EQUITY") {
        const dec = elimResolver.resolve(ent.id, l.glAccountCode, l.glAccountName);
        counterpartyId = dec.eliminate ? dec.counterpartyId : null;
      }
      positions.push({
        entityId: ent.id,
        entityName: ent.name,
        category: cls.category,
        side: cls.side,
        counterpartyId,
        accountCode: l.glAccountCode,
        accountName: l.glAccountName,
        rgsCode: l.rgsCode ?? null,
        amount: amt,
      });
    }

    // Flow positions (trade AR/AP + revenue/cost) from intercompany-tagged transactions.
    // key: `${category}|${accountCode}|${counterparty}`
    const flow = new Map<string, { p: Omit<Position, "amount">; amount: number }>();
    for (const t of txns) {
      const cp = t.contactName ? nameToCp.get(normName(t.contactName)) : undefined;
      if (!cp) continue;
      const cls = classify(t.glAccountName, t.rgsCode ?? null, t.rgsGroupCode ?? null, t.accountType === "PROFIT_LOSS");
      if (!cls || cls.basis !== "flow") continue;
      const amt = (await convert(t.amount, (t.currency || currency).toUpperCase(), currency, t.date)) ?? t.amount;
      const key = `${cls.category}|${t.glAccountCode}|${cp}`;
      const cur = flow.get(key);
      if (cur) cur.amount += amt;
      else
        flow.set(key, {
          amount: amt,
          p: {
            entityId: ent.id,
            entityName: ent.name,
            category: cls.category,
            side: cls.side,
            counterpartyId: cp,
            accountCode: t.glAccountCode,
            accountName: t.glAccountName,
            rgsCode: t.rgsCode ?? null,
          },
        });
    }
    for (const { p, amount } of flow.values()) {
      if (Math.abs(amount) < 0.005) continue;
      positions.push({ ...p, amount });
    }

    // Trade debtors/creditors from OPEN ITEMS per relation (not transaction flow):
    // an open intercompany invoice should mirror an open creditor at the
    // counterparty. Only items whose relation matches a group administration count
    // (external customers/suppliers are skipped). Receivable +, payable −, so a
    // booked pair nets to ~0 and an unbooked side reads as a one-sided mismatch.
    const cpByRelation = (relName: string | null): string | null => {
      if (!relName) return null;
      const rn = normName(relName);
      const m = candIds.find((c) => c.id !== ent.id && c.n && (rn === c.n || rn.includes(c.n) || c.n.includes(rn)));
      return m?.id ?? null;
    };
    const ar = new Map<string, number>(); // counterparty → open receivable
    const ap = new Map<string, number>(); // counterparty → open payable
    for (const it of debOpen ?? []) {
      const cp = cpByRelation(it.relationName);
      if (cp) ar.set(cp, (ar.get(cp) ?? 0) + it.openAmount);
    }
    for (const it of creOpen ?? []) {
      const cp = cpByRelation(it.relationName);
      if (cp) ap.set(cp, (ap.get(cp) ?? 0) + it.openAmount);
    }
    for (const [cp, amt] of ar) {
      if (Math.abs(amt) < 0.005) continue;
      positions.push({
        entityId: ent.id, entityName: ent.name, category: "RECEIVABLE_PAYABLE", side: "RECEIVABLE",
        counterpartyId: cp, accountCode: "—", accountName: `Openstaande debiteuren — ${nameById.get(cp) ?? ""}`.trim(),
        rgsCode: null, amount: amt,
      });
    }
    for (const [cp, amt] of ap) {
      if (Math.abs(amt) < 0.005) continue;
      positions.push({
        entityId: ent.id, entityName: ent.name, category: "RECEIVABLE_PAYABLE", side: "PAYABLE",
        counterpartyId: cp, accountCode: "—", accountName: `Openstaande crediteuren — ${nameById.get(cp) ?? ""}`.trim(),
        rgsCode: null, amount: -amt,
      });
    }
  }

  // Capital elimination only pairs a SUBSIDIARY's equity against its PARENT's
  // deelneming. An entity's equity is only relevant here if another entity holds
  // a participation (INVESTMENT) in it — that other entity is the parent. The top
  // parent's OWN equity is group equity, not an intercompany position, so it is
  // dropped (its counterparty stays null and it is filtered out below).
  for (const p of positions) {
    if (p.category !== "EQUITY_INVESTMENT" || p.side !== "EQUITY" || p.counterpartyId) continue;
    const parent = positions.find(
      (q) => q.category === "EQUITY_INVESTMENT" && q.side === "INVESTMENT" && q.counterpartyId === p.entityId,
    );
    if (parent) p.counterpartyId = parent.entityId;
  }
  // Drop equity positions of entities nobody holds a participation in (the top parent).
  const filtered = positions.filter((p) => !(p.category === "EQUITY_INVESTMENT" && p.side === "EQUITY" && !p.counterpartyId));
  positions.length = 0;
  positions.push(...filtered);

  // Aggregate per (unordered pair, category): leg amounts from each entity toward the other.
  const tol = 1; // €1 absolute tolerance (configurable later)
  const relTol = 0.005; // 0.5%
  const byPairCat = new Map<string, { a: string; b: string; cat: ReconCategory; aAmt: number; bAmt: number }>();
  for (const p of positions) {
    if (!p.counterpartyId) continue;
    const [x, y] = [p.entityId, p.counterpartyId].sort() as [string, string];
    const key = `${x}|${y}|${p.category}`;
    const e = byPairCat.get(key) ?? { a: x, b: y, cat: p.category, aAmt: 0, bAmt: 0 };
    if (p.entityId === x) e.aAmt += p.amount;
    else e.bAmt += p.amount;
    byPairCat.set(key, e);
  }

  const pairs: ReconPairResult[] = [];
  for (const e of byPairCat.values()) {
    const residual = e.aAmt + e.bAmt;
    const big = Math.max(Math.abs(e.aAmt), Math.abs(e.bAmt));
    const tolerance = Math.max(tol, big * relTol);
    let pStatus: ReconPairResult["status"];
    let warning: string;
    const oneSided = Math.abs(e.aAmt) < 0.005 || Math.abs(e.bAmt) < 0.005;
    if (oneSided && big >= tolerance) {
      pStatus = "ONE_SIDED";
      const missing = Math.abs(e.aAmt) < 0.005 ? e.a : e.b;
      warning = WARNING[e.cat].oneSided(nameById.get(missing) ?? "tegenpartij");
    } else if (Math.abs(residual) <= tolerance) {
      pStatus = "MATCHED";
      warning = "Sluit (binnen tolerantie)";
    } else {
      pStatus = "MISMATCH";
      warning = WARNING[e.cat].mismatch;
    }
    pairs.push({
      category: e.cat,
      categoryLabel: CATEGORY_LABEL[e.cat],
      aEntityId: e.a,
      aEntityName: nameById.get(e.a) ?? e.a,
      bEntityId: e.b,
      bEntityName: nameById.get(e.b) ?? e.b,
      aAmount: e.aAmt,
      bAmount: e.bAmt,
      residual,
      status: pStatus,
      warning,
    });
  }
  pairs.sort((x, y) => x.category.localeCompare(y.category) || x.aEntityName.localeCompare(y.aEntityName));

  const rows: ReconRow[] = positions
    .map((p) => ({
      category: p.category,
      categoryLabel: CATEGORY_LABEL[p.category],
      entityName: p.entityName,
      accountCode: p.accountCode,
      accountName: p.accountName,
      rgsCode: p.rgsCode,
      side: p.side,
      counterpartyName: p.counterpartyId ? (nameById.get(p.counterpartyId) ?? null) : null,
      amount: p.amount,
    }))
    .sort((a, b) => a.category.localeCompare(b.category) || a.entityName.localeCompare(b.entityName) || a.accountCode.localeCompare(b.accountCode));

  const limited = status.filter((s) => s.rateLimited);
  if (limited.length > 0) warnings.push(`Daglimiet van de koppeling bereikt voor ${limited.map((s) => s.name).join(", ")}; reconciliatie tijdelijk onvolledig.`);
  else if (status.some((s) => !s.included)) warnings.push("Niet alle administraties konden worden geladen.");

  return {
    from,
    to,
    currency,
    tolerance: tol,
    entities: status.sort((a, b) => a.name.localeCompare(b.name)),
    pairs,
    rows,
    summary: {
      matched: pairs.filter((p) => p.status === "MATCHED").length,
      oneSided: pairs.filter((p) => p.status === "ONE_SIDED").length,
      mismatched: pairs.filter((p) => p.status === "MISMATCH").length,
    },
    cachedAt: lastFetchedAt ? lastFetchedAt.toISOString() : null,
    warnings,
  };
}

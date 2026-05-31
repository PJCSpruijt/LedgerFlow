import { prisma } from "../config/prisma.js";
import { tryGetConnectorForEntity } from "../clients/connectors/registry.js";
import { applyRgsMappings } from "./rgs-mapping.service.js";
import { getIntercompanyRelations, getIntercompanyMap, normName } from "./intercompany.service.js";
import { isIntragroupCode } from "./consolidation.service.js";
import { convert, prefetchRates } from "./fx.service.js";

/**
 * Dashboard KPIs, consolidated across the scope (group or workspace) with
 * transaction-level intercompany elimination. Intercompany is detected from
 * postings tagged with a counterparty relation — so debtor invoices/receipts,
 * sales, creditor invoices/payments and cost-of-sales between group companies
 * are all netted out, not just open items.
 */

export interface MonthRevenue {
  month: string; // YYYY-MM
  gross: number;
  intercompany: number;
  net: number;
}

export interface DashboardKpis {
  from: string;
  to: string;
  currency: string;
  entities: { id: string; name: string; included: boolean; reason?: string }[];
  revenueByMonth: MonthRevenue[];
  revenueTotal: { gross: number; intercompany: number; net: number };
  cash: number;
  workingCapital: {
    net: number;
    receivables: number; // current receivables, net of intercompany
    payables: number; // current payables, net of intercompany (positive)
    receivablesGross: number;
    payablesGross: number;
    intercompanyReceivables: number;
    intercompanyPayables: number;
  };
  outstandingDebtors: { gross: number; intercompany: number; net: number };
  outstandingCreditors: { gross: number; intercompany: number; net: number };
  intercompanyConfigured: boolean;
  warnings: string[];
}

export interface DashboardInput {
  workspaceId: string;
  groupId?: string | null;
  from: string;
  to: string;
  currency: string;
}

const REV_NAME = /omzet|opbrengst|revenue|sales|turnover/i;
const isRevenue = (rgsGroupCode: string | null | undefined, accountType: string, name: string) =>
  (rgsGroupCode ?? "").startsWith("WOmz") || (accountType === "PROFIT_LOSS" && REV_NAME.test(name));

export async function computeDashboardKpis(input: DashboardInput): Promise<DashboardKpis> {
  const { workspaceId, from, to, currency } = input;
  const groupId = input.groupId ?? null;
  const warnings: string[] = [];

  const entities = await prisma.entity.findMany({
    where: groupId ? { groupId, group: { workspaceId } } : { group: { workspaceId } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const entityIds = entities.map((e) => e.id);
  const icRels = await getIntercompanyRelations(entityIds);
  const icMap = await getIntercompanyMap(entityIds);
  const intercompanyConfigured = [...icRels.values()].some((a) => a.length > 0);

  // Accumulators (reporting currency, signed = debit − credit for balances).
  const revMonth = new Map<string, { gross: number; ic: number }>();
  let recvGross = 0;
  let payGross = 0;
  let recvElim = 0;
  let payElim = 0;
  let cash = 0;
  let debGross = 0;
  let debIC = 0;
  let creGross = 0;
  let creIC = 0;
  let unmappedBalance = false;

  const status: DashboardKpis["entities"] = [];

  await Promise.all(
    entities.map(async (ent) => {
      const connector = await tryGetConnectorForEntity(ent.id);
      if (!connector) {
        status.push({ id: ent.id, name: ent.name, included: false, reason: "Geen koppeling" });
        return;
      }
      let tb, txns, deb, cre;
      try {
        [tb, txns, deb, cre] = await Promise.all([
          connector.getTrialBalance({ from, to }).then((r) => applyRgsMappings(r, workspaceId, ent.id)),
          connector.getTransactions({ from, to }).then((r) => applyRgsMappings(r, workspaceId, ent.id)),
          connector.getOutstanding("debtor"),
          connector.getOutstanding("creditor"),
        ]);
      } catch (e) {
        status.push({ id: ent.id, name: ent.name, included: false, reason: e instanceof Error ? e.message : "Ophalen mislukt" });
        return;
      }
      status.push({ id: ent.id, name: ent.name, included: true });

      // FX prefetch for balances (at period end) and transactions (at their date).
      await prefetchRates(
        [
          ...tb.map((l) => ({ date: to, from: (l.currency || currency).toUpperCase() })),
          ...txns.map((t) => ({ date: t.date, from: (t.currency || currency).toUpperCase() })),
        ],
        currency,
      );

      // Intercompany relation names → counterparty for transaction tagging.
      const rels = icRels.get(ent.id) ?? [];
      const nameToCp = new Map<string, string>();
      for (const r of rels) if (r.relationName) nameToCp.set(normName(r.relationName), r.counterpartyEntityId);
      const icRelIds = icMap.get(ent.id) ?? new Map<string, string>();

      // --- Working-capital balances + per-account intercompany flow ----------
      const balByAcct = new Map<string, { balance: number; rgsCode: string | null; group: string }>();
      for (const l of tb) {
        const conv = await convert(l.balance, (l.currency || currency).toUpperCase(), currency, to);
        const bal = conv ?? l.balance;
        const group = l.rgsGroupCode || "";
        balByAcct.set(l.glAccountCode, { balance: bal, rgsCode: l.rgsCode ?? null, group });
        if (group.startsWith("BVor")) recvGross += bal;
        else if (group.startsWith("BSch")) payGross += bal;
        else if (group.startsWith("BLim")) cash += bal;
        else if (!l.rgsGroupCode && l.accountType !== "PROFIT_LOSS") unmappedBalance = true;
      }

      // Per-account intercompany flow (transactions tagged with a counterparty).
      const icFlow = new Map<string, number>();
      for (const t of txns) {
        const conv = await convert(t.amount, (t.currency || currency).toUpperCase(), currency, t.date);
        const amt = conv ?? t.amount;
        const cp = t.contactName ? nameToCp.get(normName(t.contactName)) : undefined;

        // Revenue development per month (gross + intercompany).
        if (isRevenue(t.rgsGroupCode, t.accountType, t.glAccountName)) {
          const m = t.date.slice(0, 7);
          const r = revMonth.get(m) ?? { gross: 0, ic: 0 };
          r.gross += -amt; // credit → positive revenue
          if (cp) r.ic += -amt;
          revMonth.set(m, r);
        }
        if (cp) icFlow.set(t.glAccountCode, (icFlow.get(t.glAccountCode) ?? 0) + amt);
      }

      // Eliminate intercompany on current receivables/payables: dedicated
      // intragroup accounts at full closing balance, mixed accounts at IC flow.
      for (const [acct, flow] of icFlow) {
        if (Math.abs(flow) < 0.005) continue;
        const meta = balByAcct.get(acct);
        if (!meta) continue;
        if (meta.group.startsWith("BVor")) {
          recvElim += isIntragroupCode(meta.rgsCode) ? -meta.balance : -flow;
        } else if (meta.group.startsWith("BSch")) {
          payElim += isIntragroupCode(meta.rgsCode) ? -meta.balance : -flow;
        }
      }

      // --- Outstanding debtors / creditors (open items, IC by relation) ------
      for (const it of deb) {
        debGross += it.openAmount;
        if (icRelIds.has(it.relationId)) debIC += it.openAmount;
      }
      for (const it of cre) {
        creGross += it.openAmount;
        if (icRelIds.has(it.relationId)) creIC += it.openAmount;
      }
    }),
  );

  if (unmappedBalance) {
    warnings.push("Sommige balansrekeningen zijn nog niet aan RGS gekoppeld; werkkapitaal kan onvolledig zijn.");
  }
  if (status.some((s) => !s.included)) {
    warnings.push("Niet alle administraties konden worden geladen.");
  }

  const revenueByMonth: MonthRevenue[] = [...revMonth.entries()]
    .map(([month, v]) => ({ month, gross: v.gross, intercompany: v.ic, net: v.gross - v.ic }))
    .sort((a, b) => a.month.localeCompare(b.month));
  const revenueTotal = revenueByMonth.reduce(
    (s, m) => ({ gross: s.gross + m.gross, intercompany: s.intercompany + m.intercompany, net: s.net + m.net }),
    { gross: 0, intercompany: 0, net: 0 },
  );

  const recvNet = recvGross + recvElim; // signed (positive = receivable)
  const payNet = payGross + payElim; // signed (negative = payable)

  return {
    from,
    to,
    currency,
    entities: status.sort((a, b) => a.name.localeCompare(b.name)),
    revenueByMonth,
    revenueTotal,
    cash,
    workingCapital: {
      net: recvNet + payNet,
      receivables: recvNet,
      payables: -payNet,
      receivablesGross: recvGross,
      payablesGross: -payGross,
      intercompanyReceivables: -recvElim,
      intercompanyPayables: payElim,
    },
    outstandingDebtors: { gross: debGross, intercompany: debIC, net: debGross - debIC },
    outstandingCreditors: { gross: creGross, intercompany: creIC, net: creGross - creIC },
    intercompanyConfigured,
    warnings,
  };
}

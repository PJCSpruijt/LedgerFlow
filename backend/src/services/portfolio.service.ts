import { prisma } from "../config/prisma.js";
import { computeDashboardKpis } from "./dashboard.service.js";

/**
 * Private-Equity / investment-fund portfolio access (#41). A fund is an external
 * accessor that reads financial data across MULTIPLE portfolio companies
 * (workspaces) via one fund-scoped API key. This service manages funds +
 * holdings and produces a cross-tenant portfolio summary by reusing the existing
 * per-workspace dashboard KPIs.
 */

export interface FundHolding {
  id: string;
  workspaceId: string;
  workspaceName: string;
  label: string | null;
  stakePct: number | null;
}
export interface FundSummary {
  id: string;
  name: string;
  holdingCount: number;
  keyCount: number;
  createdAt: string;
}
export interface FundDetail extends FundSummary {
  holdings: FundHolding[];
  keys: { id: string; name: string; prefix: string; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }[];
}

export async function listFunds(): Promise<FundSummary[]> {
  const funds = await prisma.portfolioFund.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { holdings: true, apiKeys: true } } },
  });
  return funds.map((f) => ({ id: f.id, name: f.name, holdingCount: f._count.holdings, keyCount: f._count.apiKeys, createdAt: f.createdAt.toISOString() }));
}

export async function getFund(id: string): Promise<FundDetail | null> {
  const f = await prisma.portfolioFund.findUnique({
    where: { id },
    include: {
      holdings: { include: { workspace: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
      apiKeys: { orderBy: { createdAt: "desc" } },
      _count: { select: { holdings: true, apiKeys: true } },
    },
  });
  if (!f) return null;
  return {
    id: f.id,
    name: f.name,
    holdingCount: f._count.holdings,
    keyCount: f._count.apiKeys,
    createdAt: f.createdAt.toISOString(),
    holdings: f.holdings.map((h) => ({ id: h.id, workspaceId: h.workspaceId, workspaceName: h.workspace.name, label: h.label, stakePct: h.stakePct })),
    keys: f.apiKeys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString() })),
  };
}

export async function createFund(name: string, userId: string | null): Promise<{ id: string }> {
  const f = await prisma.portfolioFund.create({ data: { name: name.trim().slice(0, 160), createdByUserId: userId } });
  return { id: f.id };
}

export async function deleteFund(id: string): Promise<boolean> {
  const r = await prisma.portfolioFund.deleteMany({ where: { id } });
  return r.count > 0;
}

export async function addHolding(input: { fundId: string; workspaceId: string; label?: string | null; stakePct?: number | null }): Promise<{ id: string }> {
  const ws = await prisma.workspace.findUnique({ where: { id: input.workspaceId }, select: { id: true } });
  if (!ws) throw new Error("Werkruimte niet gevonden");
  const h = await prisma.portfolioHolding.upsert({
    where: { fundId_workspaceId: { fundId: input.fundId, workspaceId: input.workspaceId } },
    create: { fundId: input.fundId, workspaceId: input.workspaceId, label: input.label ?? null, stakePct: input.stakePct ?? null },
    update: { label: input.label ?? null, stakePct: input.stakePct ?? null },
  });
  return { id: h.id };
}

export async function removeHolding(holdingId: string): Promise<boolean> {
  const r = await prisma.portfolioHolding.deleteMany({ where: { id: holdingId } });
  return r.count > 0;
}

/** Workspaces a fund key may read (its holdings). */
export async function fundWorkspaces(fundId: string): Promise<{ id: string; name: string; label: string | null; stakePct: number | null }[]> {
  const holdings = await prisma.portfolioHolding.findMany({
    where: { fundId },
    include: { workspace: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return holdings.map((h) => ({ id: h.workspace.id, name: h.workspace.name, label: h.label, stakePct: h.stakePct }));
}

export interface PortfolioCompanyKpis {
  workspaceId: string;
  name: string;
  label: string | null;
  stakePct: number | null;
  revenue: number;
  cash: number;
  receivables: number;
  payables: number;
  warnings: string[];
}

/** Cross-tenant portfolio summary: per-company KPIs + fund totals. */
export async function portfolioSummary(input: {
  fundId: string;
  from: string;
  to: string;
  currency: string;
}): Promise<{ currency: string; from: string; to: string; companies: PortfolioCompanyKpis[]; totals: { revenue: number; cash: number; receivables: number; payables: number } }> {
  const companies = await fundWorkspaces(input.fundId);
  const rows = await Promise.all(
    companies.map(async (c) => {
      try {
        const k = await computeDashboardKpis({ workspaceId: c.id, from: input.from, to: input.to, currency: input.currency });
        return {
          workspaceId: c.id,
          name: c.name,
          label: c.label,
          stakePct: c.stakePct,
          revenue: k.revenueTotal.net,
          cash: k.cash,
          receivables: k.outstandingDebtors.net,
          payables: k.outstandingCreditors.net,
          warnings: k.warnings,
        } as PortfolioCompanyKpis;
      } catch (e) {
        return { workspaceId: c.id, name: c.name, label: c.label, stakePct: c.stakePct, revenue: 0, cash: 0, receivables: 0, payables: 0, warnings: [e instanceof Error ? e.message : "Kon cijfers niet ophalen"] };
      }
    }),
  );
  const totals = rows.reduce(
    (acc, r) => ({ revenue: acc.revenue + r.revenue, cash: acc.cash + r.cash, receivables: acc.receivables + r.receivables, payables: acc.payables + r.payables }),
    { revenue: 0, cash: 0, receivables: 0, payables: 0 },
  );
  return { currency: input.currency, from: input.from, to: input.to, companies: rows, totals };
}

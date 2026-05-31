import { randomUUID } from "node:crypto";
import { Router, type Response } from "express";
import type { ApiKey } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import type { Request } from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireApiKey } from "../middleware/apiKey.js";
import { getRequestContext } from "../config/request-context.js";
import { getConnectorForEntity } from "../clients/connectors/registry.js";
import { applyVatMappings } from "../services/vat-mapping.service.js";
import {
  applyRgsMappings,
  getActiveMappings,
  listFinCategories,
  resolveRgsVersion,
} from "../services/rgs-mapping.service.js";
import { listSourceAccounts } from "../services/source-account.service.js";
import { convert, prefetchRates } from "../services/fx.service.js";
import { BadRequestError, ForbiddenError, NotFoundError } from "../utils/errors.js";
import type { TransactionLine } from "../clients/connectors/interfaces/Connector.js";

/**
 * FIN//HUB Output API v1 (#30) — external, read-only, API-key-authenticated.
 * Exposes the normalized / semantic model (NOT connector-native structures) for
 * tools like Visionplanner, Caseware, Power BI and Excel Power Query.
 *
 * Every response is wrapped in a metadata envelope; every request is logged as
 * INBOUND/API traffic in the usage ledger (see middleware/apiKey).
 */

export const v1Router = Router();

/** Wrap a payload in the standard v1 envelope (request id + generation metadata). */
function sendV1(res: Response, data: unknown, meta: Record<string, unknown> = {}): void {
  res.json({
    data,
    meta: {
      requestId: getRequestContext()?.correlationId ?? randomUUID(),
      generatedAt: new Date().toISOString(),
      apiVersion: "v1",
      ...meta,
    },
  });
}

const keyOf = (res: Response): ApiKey => res.locals.apiKey as ApiKey;

// ---- Discovery (public, no key) -------------------------------------------
const OPENAPI = {
  openapi: "3.0.3",
  info: {
    title: "FIN//HUB Output API",
    version: "1.0.0",
    description:
      "Read-only access to FIN//HUB's normalized, RGS-mapped and (later) consolidated financial data.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      apiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
      bearer: { type: "http", scheme: "bearer" },
    },
  },
  security: [{ apiKey: [] }, { bearer: [] }],
  paths: {
    "/ping": { get: { summary: "Health/auth check" } },
    "/workspaces": { get: { summary: "Tenant: the key's workspace" } },
    "/groups": { get: { summary: "Tenant: consolidation groups" } },
    "/entities": { get: { summary: "Tenant: administrations" } },
    "/chart-of-accounts": { get: { summary: "Source GL accounts (entityId required)" } },
    "/account-mappings": { get: { summary: "Source→RGS+FIN mappings (entityId)" } },
    "/rgs-mappings": { get: { summary: "RGS taxonomy (q, limit, offset)" } },
    "/fin-categories": { get: { summary: "FIN semantic categories" } },
    "/trial-balance": { get: { summary: "Trial balance (entityId, from, to)" } },
    "/transactions": { get: { summary: "Transactions export (entityId, from, to, currency, rgs_code, fin_category, format=csv)" } },
    "/general-ledger": { get: { summary: "Alias of /transactions" } },
    "/receivables": { get: { summary: "Open receivables + aging (entityId)" } },
    "/payables": { get: { summary: "Open payables + aging (entityId)" } },
    "/relations": { get: { summary: "Debtors + creditors (entityId)" } },
  },
} as const;

v1Router.get("/openapi.json", (_req, res) => res.json(OPENAPI));

// ---- Authenticated, read-only ---------------------------------------------
v1Router.use(requireApiKey);

v1Router.get("/ping", (_req, res) => sendV1(res, { ok: true }));

v1Router.get(
  "/workspaces",
  asyncHandler(async (_req, res) => {
    const key = keyOf(res);
    const ws = await prisma.workspace.findUnique({
      where: { id: key.workspaceId },
      select: { id: true, name: true, type: true },
    });
    sendV1(res, ws ? [ws] : []);
  }),
);

v1Router.get(
  "/groups",
  asyncHandler(async (_req, res) => {
    const key = keyOf(res);
    const groups = await prisma.group.findMany({
      where: { workspaceId: key.workspaceId },
      select: { id: true, name: true, workspaceId: true },
      orderBy: { name: "asc" },
    });
    sendV1(res, groups);
  }),
);

v1Router.get(
  "/entities",
  asyncHandler(async (_req, res) => {
    const key = keyOf(res);
    const entities = await prisma.entity.findMany({
      where: {
        group: { workspaceId: key.workspaceId },
        ...(key.entityId ? { id: key.entityId } : {}),
      },
      select: { id: true, name: true, groupId: true },
      orderBy: { name: "asc" },
    });
    sendV1(res, entities);
  }),
);

// ---- Shared helpers --------------------------------------------------------

interface ScopedEntity {
  id: string;
  name: string;
  groupId: string;
  workspaceId: string;
  connectorType: string;
}

/** Resolve + authorize the requested entity against the key's scope. */
async function resolveEntity(req: Request, res: Response): Promise<ScopedEntity> {
  const key = keyOf(res);
  const requested = String(req.query.entityId ?? "").trim() || key.entityId || "";
  if (!requested) throw new BadRequestError("Parameter 'entityId' is verplicht (of geef de sleutel een vast bereik)");
  if (key.entityId && key.entityId !== requested)
    throw new ForbiddenError("Buiten het bereik van deze API-sleutel");
  const ent = await prisma.entity.findFirst({
    where: { id: requested, group: { workspaceId: key.workspaceId } },
    select: { id: true, name: true, groupId: true, connection: { select: { kind: true } } },
  });
  if (!ent) throw new NotFoundError("Administratie niet gevonden in deze werkruimte");
  return { id: ent.id, name: ent.name, groupId: ent.groupId, workspaceId: key.workspaceId, connectorType: ent.connection?.kind ?? "—" };
}

const csvEscape = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function toCsv(rows: Record<string, unknown>[]): string {
  const first = rows[0];
  if (!first) return "";
  const cols = Object.keys(first);
  return [cols.join(","), ...rows.map((r) => cols.map((c) => csvEscape(r[c])).join(","))].join("\n");
}

/** Respond as JSON envelope, or as CSV when ?format=csv. */
function respond(req: Request, res: Response, rows: Record<string, unknown>[], meta: Record<string, unknown> = {}): void {
  if (String(req.query.format ?? "").toLowerCase() === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("X-Request-Id", getRequestContext()?.correlationId ?? "");
    res.setHeader("X-Generated-At", new Date().toISOString());
    res.send(toCsv(rows));
    return;
  }
  sendV1(res, rows, meta);
}

function paginate<T>(req: Request, arr: T[]): { page: T[]; meta: Record<string, number> } {
  const limit = Math.min(Number(req.query.limit) || 1000, 10_000);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  return { page: arr.slice(offset, offset + limit), meta: { total: arr.length, limit, offset } };
}

function dateRange(req: Request): { from: string; to: string; currency: string } {
  const now = new Date();
  return {
    from: String(req.query.from ?? `${now.getFullYear()}-01-01`),
    to: String(req.query.to ?? now.toISOString().slice(0, 10)),
    currency: String(req.query.currency ?? "EUR").toUpperCase(),
  };
}

/** Fetch + normalize transactions (VAT + RGS + FX + rgs descriptions). */
async function loadTransactions(
  ent: ScopedEntity,
  from: string,
  to: string,
  currency: string,
): Promise<(TransactionLine & { rgsDescription?: string | null })[]> {
  const connector = await getConnectorForEntity(ent.id);
  const data = await connector.getTransactions({ from, to });
  const vat = await applyVatMappings(data, ent.workspaceId, ent.id);
  const lines = await applyRgsMappings(vat, ent.workspaceId, ent.id);

  await prefetchRates(lines.map((l) => ({ date: l.date, from: (l.currency || currency).toUpperCase() })), currency);
  for (const l of lines) {
    const conv = await convert(l.amount, (l.currency || currency).toUpperCase(), currency, l.date);
    l.reportingAmount = conv ?? l.amount;
    l.reportingCurrency = conv != null ? currency : (l.currency || currency);
  }
  const codes = [...new Set(lines.map((l) => l.rgsCode).filter((c): c is string => !!c))];
  if (codes.length) {
    const version = await resolveRgsVersion(ent.workspaceId);
    const rows = await prisma.rgsAccount.findMany({ where: { version, code: { in: codes } }, select: { code: true, description: true } });
    const m = new Map(rows.map((r) => [r.code, r.description]));
    for (const l of lines) (l as { rgsDescription?: string | null }).rgsDescription = l.rgsCode ? (m.get(l.rgsCode) ?? null) : null;
  }
  return lines;
}

/** Map an enriched transaction line to the canonical export-line shape (#30). */
function txExportLine(t: TransactionLine & { rgsDescription?: string | null }, ent: ScopedEntity, currency: string) {
  const rep = t.reportingAmount ?? t.amount;
  return {
    workspace_id: ent.workspaceId,
    group_id: ent.groupId,
    entity_id: ent.id,
    entity_name: ent.name,
    period: (t.date || "").slice(0, 7),
    source_system: ent.connectorType,
    source_account_code: t.glAccountCode,
    source_account_name: t.glAccountName,
    rgs_code: t.rgsCode ?? null,
    rgs_description: t.rgsDescription ?? t.rgsGroupName ?? null,
    fin_category: t.finCategory ?? null,
    debit: rep > 0 ? rep : 0,
    credit: rep < 0 ? -rep : 0,
    balance: rep,
    currency: t.reportingCurrency ?? currency,
    relation_id: null,
    relation_name: t.contactName ?? null,
    transaction_date: t.date,
    source_transaction_id: t.reference ?? null,
    source_document_id: t.documentId ?? null,
    is_elimination: false,
    is_consolidated: false,
    mapping_source: t.rgsCode ? "rgs_mapping" : null,
    mapping_confidence: t.mappingConfidence ?? null,
    generated_at: new Date().toISOString(),
  };
}

// ---- Chart of accounts & mappings (DB) ------------------------------------

v1Router.get(
  "/chart-of-accounts",
  asyncHandler(async (req, res) => {
    const ent = await resolveEntity(req, res);
    const accounts = await listSourceAccounts(ent.id);
    const rows = accounts.map((a) => ({
      entity_id: ent.id,
      entity_name: ent.name,
      source_account_code: a.code,
      source_account_name: a.name,
      account_type: a.accountType,
    }));
    respond(req, res, rows);
  }),
);

v1Router.get(
  "/account-mappings",
  asyncHandler(async (req, res) => {
    const ent = await resolveEntity(req, res);
    const mappings = await getActiveMappings(ent.id);
    const rows = mappings.map((m) => ({
      entity_id: ent.id,
      source_account_code: m.sourceAccountCode,
      rgs_version: m.rgsVersion,
      rgs_code: m.rgsCode,
      fin_category: m.finCategory?.key ?? null,
      mapping_confidence: m.confidence,
    }));
    respond(req, res, rows);
  }),
);

v1Router.get(
  "/rgs-mappings",
  asyncHandler(async (_req, res) => {
    const key = keyOf(res);
    const version = await resolveRgsVersion(key.workspaceId);
    const { page, meta } = paginate(_req, await prisma.rgsAccount.findMany({
      where: {
        version,
        ...(typeof _req.query.q === "string" && _req.query.q
          ? { OR: [{ code: { contains: _req.query.q, mode: "insensitive" } }, { description: { contains: _req.query.q, mode: "insensitive" } }] }
          : {}),
      },
      orderBy: [{ level: "asc" }, { code: "asc" }],
      select: { code: true, description: true, parentCode: true, level: true, isBalanceSheet: true, isProfitLoss: true, dc: true },
    }));
    respond(
      _req,
      res,
      page.map((r) => ({
        rgs_version: version,
        rgs_code: r.code,
        rgs_description: r.description,
        parent_code: r.parentCode,
        level: r.level,
        is_balance_sheet: r.isBalanceSheet,
        is_profit_loss: r.isProfitLoss,
        dc: r.dc,
      })),
      { ...meta, rgsVersion: version },
    );
  }),
);

v1Router.get(
  "/fin-categories",
  asyncHandler(async (_req, res) => {
    const key = keyOf(res);
    const cats = await listFinCategories(key.workspaceId);
    respond(_req, res, cats.map((c) => ({ key: c.key, label: c.label, kind: c.kind, workspace_scoped: c.workspaceId !== null })));
  }),
);

// ---- Trial balance / transactions / general ledger (connector) ------------

v1Router.get(
  "/trial-balance",
  asyncHandler(async (req, res) => {
    const ent = await resolveEntity(req, res);
    const { from, to } = dateRange(req);
    const connector = await getConnectorForEntity(ent.id);
    const tb = await applyRgsMappings(await connector.getTrialBalance({ from, to }), ent.workspaceId, ent.id);
    const rows = tb.map((l) => ({
      workspace_id: ent.workspaceId,
      group_id: ent.groupId,
      entity_id: ent.id,
      entity_name: ent.name,
      source_system: ent.connectorType,
      source_account_code: l.glAccountCode,
      source_account_name: l.glAccountName,
      account_type: l.accountType,
      rgs_code: l.rgsCode ?? null,
      rgs_group: l.rgsGroupName ?? null,
      debit: l.debit,
      credit: l.credit,
      balance: l.balance,
      currency: l.currency,
      generated_at: new Date().toISOString(),
    }));
    respond(req, res, rows, { period: { from, to } });
  }),
);

const transactionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const ent = await resolveEntity(req, res);
  const { from, to, currency } = dateRange(req);
  let lines = await loadTransactions(ent, from, to, currency);

  // Optional filters
  const f = req.query;
  if (typeof f.source_account_code === "string") lines = lines.filter((l) => l.glAccountCode === f.source_account_code);
  if (typeof f.rgs_code === "string") lines = lines.filter((l) => l.rgsCode === f.rgs_code);
  if (typeof f.fin_category === "string") lines = lines.filter((l) => l.finCategory === f.fin_category);

  const exported = lines.map((l) => txExportLine(l, ent, currency));
  const { page, meta } = paginate(req, exported);
  respond(req, res, page, { ...meta, period: { from, to }, currency });
});

v1Router.get("/transactions", transactionsHandler);
v1Router.get("/general-ledger", transactionsHandler);

// ---- Receivables / payables / relations (connector) -----------------------

async function outstanding(req: Request, res: Response, kind: "debtor" | "creditor") {
  const ent = await resolveEntity(req, res);
  const connector = await getConnectorForEntity(ent.id);
  const items = await connector.getOutstanding(kind);
  const today = Date.now();
  const rows = items.map((it) => {
    const ref = it.dueDate || it.date;
    const age = Math.floor((today - new Date(`${ref}T00:00:00`).getTime()) / 86_400_000);
    return {
      workspace_id: ent.workspaceId,
      entity_id: ent.id,
      entity_name: ent.name,
      relation_id: it.relationId,
      relation_name: it.relationName,
      relation_code: it.relationCode,
      invoice_number: it.invoiceNumber,
      invoice_date: it.date,
      due_date: it.dueDate,
      total_amount: it.totalAmount,
      open_amount: it.openAmount,
      days_overdue: age > 0 ? age : 0,
      aging_bucket: age <= 0 ? "current" : age <= 30 ? "1-30" : age <= 60 ? "31-60" : age <= 90 ? "61-90" : "90+",
      generated_at: new Date().toISOString(),
    };
  });
  respond(req, res, rows);
}

v1Router.get("/receivables", asyncHandler((req, res) => outstanding(req, res, "debtor")));
v1Router.get("/payables", asyncHandler((req, res) => outstanding(req, res, "creditor")));

v1Router.get(
  "/relations",
  asyncHandler(async (req, res) => {
    const ent = await resolveEntity(req, res);
    const connector = await getConnectorForEntity(ent.id);
    const [debtors, creditors] = await Promise.all([connector.getDebtors(), connector.getCreditors()]);
    const byId = new Map<string, { id: string; name: string; code: string | null; isDebtor: boolean; isCreditor: boolean }>();
    for (const c of debtors) byId.set(c.id, { id: c.id, name: c.name, code: c.code, isDebtor: true, isCreditor: false });
    for (const c of creditors) {
      const cur = byId.get(c.id);
      if (cur) cur.isCreditor = true;
      else byId.set(c.id, { id: c.id, name: c.name, code: c.code, isDebtor: false, isCreditor: true });
    }
    const rows = [...byId.values()].map((r) => ({
      entity_id: ent.id,
      relation_id: r.id,
      relation_name: r.name,
      relation_code: r.code,
      is_debtor: r.isDebtor,
      is_creditor: r.isCreditor,
    }));
    respond(req, res, rows);
  }),
);

// Relation mappings: reserved for a later phase (relation normalization).
v1Router.get("/relation-mappings", (_req, res) => sendV1(res, [], { note: "Relation mapping arrives in a later phase." }));

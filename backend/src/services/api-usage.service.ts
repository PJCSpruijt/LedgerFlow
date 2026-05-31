import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";
import { getRequestContext } from "../config/request-context.js";
import type { ConnectorContext } from "../clients/connectors/context.js";

/**
 * API Usage Ledger (#26): log EVERY outbound connector request. The logging is
 * fire-and-forget — it must never block or fail the connector call.
 *
 * SECURITY: callers pass only safe metadata (endpoint, method, status, sizes,
 * hashes). Never pass API keys/tokens or full payloads; `requestHash`/
 * `responseHash` are sha256 digests, not the content.
 */

export const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

/** Classify a connector call into a coarse operation type for reporting. */
export function classifyOperation(
  connectorType: string,
  endpoint: string,
  method?: string,
): string {
  const e = endpoint.toLowerCase();
  if (connectorType === "YUKI") {
    if (/authenticate/.test(e)) return "auth";
    if (/transactiondocument|getdocument/.test(e)) return "document_retrieval";
    if (/transaction/.test(e)) return "transactions_sync";
    if (/glaccountbalance|balance/.test(e)) return "trial_balance_sync";
    if (/outstanding/.test(e)) return "outstanding_sync";
    if (/contact/.test(e)) return "relations_sync";
    if (/administration/.test(e)) return "administration_discovery";
    return "other";
  }
  // e-Boekhouden REST
  if (/\/session/.test(e)) return method === "DELETE" ? "session_close" : "token_refresh";
  if (/\/ledger/.test(e)) return "coa_sync";
  if (/outstanding/.test(e)) return "outstanding_sync";
  if (/\/mutation/.test(e)) return "transactions_sync";
  if (/\/relation/.test(e)) return "relations_sync";
  if (/\/invoice/.test(e)) return "document_retrieval";
  if (/\/administration/.test(e)) return "administration_discovery";
  return "other";
}

export interface ApiUsageInput {
  context: ConnectorContext | null;
  /** Defaults to "OUTBOUND" (connector calls). Inbound Output-API logging sets this. */
  direction?: "OUTBOUND" | "INBOUND";
  startedAt: Date;
  endedAt: Date;
  operationType: string;
  endpointName: string;
  httpMethod?: string | null;
  soapAction?: string | null;
  statusCode?: number | null;
  success: boolean;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryCount?: number;
  recordsReceived?: number | null;
  bytesSent?: number | null;
  bytesReceived?: number | null;
  paginationCursor?: string | null;
  rateLimitLimit?: number | null;
  rateLimitRemaining?: number | null;
  rateLimitResetAt?: Date | null;
  requestHash?: string | null;
  responseHash?: string | null;
}

/** Aggregated connector/API usage for the platform statistics dashboard. */
export async function getUsageSummary(days: number) {
  const since = new Date(Date.now() - days * 86_400_000);
  const where = { startedAt: { gte: since } };

  const [agg, failed, byChannel, byConnector, byOperation, byWorkspaceRaw, topErrors] =
    await Promise.all([
      prisma.apiUsageLog.aggregate({
        where,
        _count: { _all: true },
        _sum: { retryCount: true, bytesReceived: true, bytesSent: true },
        _avg: { durationMs: true },
      }),
      prisma.apiUsageLog.count({ where: { ...where, success: false } }),
      prisma.apiUsageLog.groupBy({ by: ["initiatorType", "direction"], where, _count: { _all: true } }),
      prisma.apiUsageLog.groupBy({
        by: ["connectorType"],
        where,
        _count: { _all: true },
        _avg: { durationMs: true },
      }),
      prisma.apiUsageLog.groupBy({ by: ["operationType"], where, _count: { _all: true } }),
      prisma.apiUsageLog.groupBy({ by: ["workspaceId"], where, _count: { _all: true } }),
      prisma.apiUsageLog.groupBy({
        by: ["operationType", "connectorType", "statusCode"],
        where: { ...where, success: false },
        _count: { _all: true },
      }),
    ]);

  const failedByChannel = await prisma.apiUsageLog.groupBy({
    by: ["initiatorType", "direction"],
    where: { ...where, success: false },
    _count: { _all: true },
  });
  const failedKey = (i: string, d: string) => `${i}|${d}`;
  const failedMap = new Map(
    failedByChannel.map((r) => [failedKey(r.initiatorType, r.direction), r._count._all]),
  );

  const wsIds = byWorkspaceRaw.map((w) => w.workspaceId).filter((x): x is string => !!x);
  const wss = wsIds.length
    ? await prisma.workspace.findMany({ where: { id: { in: wsIds } }, select: { id: true, name: true } })
    : [];
  const wsName = new Map(wss.map((w) => [w.id, w.name]));

  const documentDownloads = byOperation.find((o) => o.operationType === "document_retrieval")?._count._all ?? 0;
  const retries = agg._sum.retryCount ?? 0;

  return {
    days,
    totals: {
      calls: agg._count._all,
      failed,
      success: agg._count._all - failed,
      retries,
      documentDownloads,
      avgDurationMs: Math.round(agg._avg.durationMs ?? 0),
      bytesReceived: agg._sum.bytesReceived ?? 0,
      bytesSent: agg._sum.bytesSent ?? 0,
    },
    byChannel: byChannel
      .map((c) => ({
        initiatorType: c.initiatorType,
        direction: c.direction,
        calls: c._count._all,
        failed: failedMap.get(failedKey(c.initiatorType, c.direction)) ?? 0,
      }))
      .sort((a, b) => b.calls - a.calls),
    byConnector: byConnector
      .map((c) => ({
        connectorType: c.connectorType ?? "—",
        calls: c._count._all,
        avgDurationMs: Math.round(c._avg.durationMs ?? 0),
      }))
      .sort((a, b) => b.calls - a.calls),
    byOperation: byOperation
      .map((o) => ({ operationType: o.operationType, calls: o._count._all }))
      .sort((a, b) => b.calls - a.calls),
    byWorkspace: byWorkspaceRaw
      .map((w) => ({
        workspaceId: w.workspaceId,
        workspaceName: w.workspaceId ? (wsName.get(w.workspaceId) ?? w.workspaceId) : "—",
        calls: w._count._all,
      }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 12),
    topErrors: topErrors
      .map((e) => ({
        operationType: e.operationType,
        connectorType: e.connectorType ?? "—",
        statusCode: e.statusCode,
        count: e._count._all,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}

/** Write one usage-ledger row. Fire-and-forget; swallows its own errors. */
export function logApiUsage(input: ApiUsageInput): void {
  const reqCtx = getRequestContext();
  const ctx = input.context;
  prisma.apiUsageLog
    .create({
      data: {
        requestId: randomUUID(),
        correlationId: reqCtx?.correlationId ?? null,
        initiatedBy: reqCtx?.userId ?? null,
        // Channel: connector clients always log OUTBOUND; initiatorType comes from
        // the request context (USER for UI sessions, API for Output-API clients,
        // else SYSTEM for cron/background work).
        initiatorType: reqCtx?.initiatorType ?? "SYSTEM",
        direction: input.direction ?? "OUTBOUND",
        apiClientId: reqCtx?.apiClientId ?? null,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        durationMs: Math.max(0, input.endedAt.getTime() - input.startedAt.getTime()),
        workspaceId: ctx?.workspaceId ?? null,
        groupId: ctx?.groupId ?? null,
        entityId: ctx?.entityId ?? null,
        connectorType: ctx?.connectorType ?? null,
        connectorAccountId: ctx?.connectionId ?? null,
        sourceAdministrationId: ctx?.sourceAdministrationId ?? null,
        operationType: input.operationType,
        endpointName: input.endpointName,
        httpMethod: input.httpMethod ?? null,
        soapAction: input.soapAction ?? null,
        statusCode: input.statusCode ?? null,
        success: input.success,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage?.slice(0, 500) ?? null,
        retryCount: input.retryCount ?? 0,
        recordsReceived: input.recordsReceived ?? null,
        bytesSent: input.bytesSent ?? null,
        bytesReceived: input.bytesReceived ?? null,
        paginationCursor: input.paginationCursor ?? null,
        rateLimitLimit: input.rateLimitLimit ?? null,
        rateLimitRemaining: input.rateLimitRemaining ?? null,
        rateLimitResetAt: input.rateLimitResetAt ?? null,
        requestHash: input.requestHash ?? null,
        responseHash: input.responseHash ?? null,
      },
    })
    .catch((err) => logger.warn({ err }, "Failed to write ApiUsageLog (non-fatal)"));
}

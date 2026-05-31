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

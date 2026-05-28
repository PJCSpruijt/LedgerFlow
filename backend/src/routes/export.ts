import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateQuery } from "../middleware/validate.js";
import { requireAuth, requireScope } from "../middleware/auth.js";
import { requireActiveSubscription } from "../middleware/subscription.js";
import { getConnectorForEntity } from "../clients/connectors/registry.js";
import {
  buildTransactionsWorkbook,
  buildTrialBalanceWorkbook,
} from "../services/export.service.js";
import { BadRequestError } from "../utils/errors.js";

export const exportRouter = Router();

const RangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** Exports run against a single entity, so one must be selected. */
function requireEntity(req: import("express").Request): string {
  const entityId = req.scope?.entityId;
  if (!entityId) throw new BadRequestError("Select an entity (x-entity-id) to export");
  return entityId;
}

function sendXlsx(res: import("express").Response, buf: Buffer, filename: string): void {
  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", String(buf.byteLength));
  res.end(buf);
}

exportRouter.get(
  "/trial-balance.xlsx",
  requireAuth,
  requireScope,
  requireActiveSubscription,
  validateQuery(RangeQuery),
  asyncHandler(async (req, res) => {
    const entityId = requireEntity(req);
    const [connector, entity] = await Promise.all([
      getConnectorForEntity(entityId),
      prisma.entity.findUniqueOrThrow({ where: { id: entityId } }),
    ]);
    const range = req.query as unknown as { from: string; to: string };
    const rows = await connector.getTrialBalance(range);
    const buf = await buildTrialBalanceWorkbook(
      {
        entityName: entity.name,
        generatedAt: new Date(),
        from: range.from,
        to: range.to,
        connectorKind: connector.kind,
      },
      rows,
    );
    await prisma.auditLog.create({
      data: {
        workspaceId: req.scope!.workspaceId,
        entityId,
        userId: req.user!.id,
        action: "export.trial-balance",
        metadata: { from: range.from, to: range.to, count: rows.length },
      },
    });
    sendXlsx(res, buf, `ledgerflow-proefbalans-${range.from}_${range.to}.xlsx`);
  }),
);

exportRouter.get(
  "/transactions.xlsx",
  requireAuth,
  requireScope,
  requireActiveSubscription,
  validateQuery(RangeQuery),
  asyncHandler(async (req, res) => {
    const entityId = requireEntity(req);
    const [connector, entity] = await Promise.all([
      getConnectorForEntity(entityId),
      prisma.entity.findUniqueOrThrow({ where: { id: entityId } }),
    ]);
    const range = req.query as unknown as { from: string; to: string };
    const rows = await connector.getTransactions(range);
    const buf = await buildTransactionsWorkbook(
      {
        entityName: entity.name,
        generatedAt: new Date(),
        from: range.from,
        to: range.to,
        connectorKind: connector.kind,
      },
      rows,
    );
    await prisma.auditLog.create({
      data: {
        workspaceId: req.scope!.workspaceId,
        entityId,
        userId: req.user!.id,
        action: "export.transactions",
        metadata: { from: range.from, to: range.to, count: rows.length },
      },
    });
    sendXlsx(res, buf, `ledgerflow-mutaties-${range.from}_${range.to}.xlsx`);
  }),
);

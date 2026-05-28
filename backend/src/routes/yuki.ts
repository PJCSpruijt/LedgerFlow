import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { encryptJson } from "../utils/crypto.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  requireAuth,
  requireScope,
  requireScopeRole,
  SCOPE_ADMIN_ROLES,
} from "../middleware/auth.js";
import { requireActiveSubscription } from "../middleware/subscription.js";
import { getConnectorForEntity } from "../clients/connectors/registry.js";
import { YukiConnector } from "../clients/connectors/yuki/YukiConnector.js";
import { BadRequestError } from "../utils/errors.js";

export const yukiRouter = Router();

/** The Yuki connection lives on an entity, so an entity must be selected. */
function requireEntity(req: import("express").Request): string {
  const entityId = req.scope?.entityId;
  if (!entityId) throw new BadRequestError("Select an entity (x-entity-id) for connector operations");
  return entityId;
}

const ConnectionSchema = z.object({
  accessKey: z.string().min(20, "Yuki access key looks too short"),
  administrationId: z.string().uuid("administrationId must be a UUID"),
  environment: z.enum(["PRODUCTION", "SANDBOX"]).default("PRODUCTION"),
});

/** Store or update the Yuki credentials for the active entity. */
yukiRouter.put(
  "/connection",
  requireAuth,
  requireScope,
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateBody(ConnectionSchema),
  asyncHandler(async (req, res) => {
    const entityId = requireEntity(req);
    const encryptedCredentials = encryptJson({
      accessKey: req.body.accessKey,
      administrationId: req.body.administrationId,
    });

    const conn = await prisma.yukiConnection.upsert({
      where: { entityId },
      create: { entityId, encryptedCredentials, environment: req.body.environment },
      update: { encryptedCredentials, environment: req.body.environment },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId: req.scope!.workspaceId,
        entityId,
        userId: req.user!.id,
        action: "yuki.connection.updated",
      },
    });

    res.json({
      connection: { id: conn.id, environment: conn.environment, updatedAt: conn.updatedAt },
    });
  }),
);

yukiRouter.delete(
  "/connection",
  requireAuth,
  requireScope,
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  asyncHandler(async (req, res) => {
    const entityId = requireEntity(req);
    await prisma.yukiConnection.deleteMany({ where: { entityId } });
    res.json({ ok: true });
  }),
);

yukiRouter.get(
  "/connection",
  requireAuth,
  requireScope,
  asyncHandler(async (req, res) => {
    const entityId = requireEntity(req);
    const conn = await prisma.yukiConnection.findUnique({ where: { entityId } });
    res.json({
      connection: conn
        ? {
            id: conn.id,
            environment: conn.environment,
            lastTestedAt: conn.lastTestedAt,
            lastSyncAt: conn.lastSyncAt,
            updatedAt: conn.updatedAt,
          }
        : null,
    });
  }),
);

yukiRouter.get(
  "/test-connection",
  requireAuth,
  requireScope,
  asyncHandler(async (req, res) => {
    const entityId = requireEntity(req);
    const connector = await getConnectorForEntity(entityId);
    const result = await connector.testConnection();

    if (connector instanceof YukiConnector) {
      await prisma.yukiConnection.update({
        where: { entityId },
        data: { lastTestedAt: new Date() },
      });
    }

    res.json(result);
  }),
);

const DateRangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "from must be yyyy-MM-dd"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "to must be yyyy-MM-dd"),
});

yukiRouter.get(
  "/trial-balance",
  requireAuth,
  requireScope,
  requireActiveSubscription,
  validateQuery(DateRangeQuery),
  asyncHandler(async (req, res) => {
    const connector = await getConnectorForEntity(requireEntity(req));
    const data = await connector.getTrialBalance(req.query as unknown as { from: string; to: string });
    res.json({ range: req.query, rows: data });
  }),
);

yukiRouter.get(
  "/transactions",
  requireAuth,
  requireScope,
  requireActiveSubscription,
  validateQuery(DateRangeQuery),
  asyncHandler(async (req, res) => {
    const connector = await getConnectorForEntity(requireEntity(req));
    const data = await connector.getTransactions(req.query as unknown as { from: string; to: string });
    res.json({ range: req.query, rows: data });
  }),
);

yukiRouter.get(
  "/debtors",
  requireAuth,
  requireScope,
  requireActiveSubscription,
  asyncHandler(async (req, res) => {
    const connector = await getConnectorForEntity(requireEntity(req));
    res.json({ contacts: await connector.getDebtors() });
  }),
);

yukiRouter.get(
  "/creditors",
  requireAuth,
  requireScope,
  requireActiveSubscription,
  asyncHandler(async (req, res) => {
    const connector = await getConnectorForEntity(requireEntity(req));
    res.json({ contacts: await connector.getCreditors() });
  }),
);

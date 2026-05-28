import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { encryptJson } from "../utils/crypto.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import { requireAuth, requireOrganization, requireRole } from "../middleware/auth.js";
import { requireActiveSubscription } from "../middleware/subscription.js";
import { getConnectorForOrganization } from "../clients/connectors/registry.js";
import { YukiConnector } from "../clients/connectors/yuki/YukiConnector.js";

export const yukiRouter = Router();

const ConnectionSchema = z.object({
  accessKey: z.string().min(20, "Yuki access key looks too short"),
  administrationId: z.string().uuid("administrationId must be a UUID"),
  environment: z.enum(["PRODUCTION", "SANDBOX"]).default("PRODUCTION"),
});

/** Store or update the Yuki credentials for the active organization. */
yukiRouter.put(
  "/connection",
  requireAuth,
  requireOrganization,
  requireRole("ADMIN"),
  validateBody(ConnectionSchema),
  asyncHandler(async (req, res) => {
    const orgId = req.organization!.id;
    const encryptedCredentials = encryptJson({
      accessKey: req.body.accessKey,
      administrationId: req.body.administrationId,
    });

    const conn = await prisma.yukiConnection.upsert({
      where: { organizationId: orgId },
      create: {
        organizationId: orgId,
        encryptedCredentials,
        environment: req.body.environment,
      },
      update: {
        encryptedCredentials,
        environment: req.body.environment,
      },
    });

    await prisma.auditLog.create({
      data: {
        organizationId: orgId,
        userId: req.user!.id,
        action: "yuki.connection.updated",
      },
    });

    res.json({
      connection: {
        id: conn.id,
        environment: conn.environment,
        updatedAt: conn.updatedAt,
      },
    });
  }),
);

yukiRouter.delete(
  "/connection",
  requireAuth,
  requireOrganization,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    await prisma.yukiConnection.deleteMany({
      where: { organizationId: req.organization!.id },
    });
    res.json({ ok: true });
  }),
);

yukiRouter.get(
  "/connection",
  requireAuth,
  requireOrganization,
  asyncHandler(async (req, res) => {
    const conn = await prisma.yukiConnection.findUnique({
      where: { organizationId: req.organization!.id },
    });
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
  requireOrganization,
  asyncHandler(async (req, res) => {
    const connector = await getConnectorForOrganization(req.organization!.id);
    const result = await connector.testConnection();

    // Persist lastTestedAt for real Yuki connections.
    if (connector instanceof YukiConnector) {
      await prisma.yukiConnection.update({
        where: { organizationId: req.organization!.id },
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
  requireOrganization,
  requireActiveSubscription,
  validateQuery(DateRangeQuery),
  asyncHandler(async (req, res) => {
    const connector = await getConnectorForOrganization(req.organization!.id);
    const data = await connector.getTrialBalance(req.query as unknown as { from: string; to: string });
    res.json({ range: req.query, rows: data });
  }),
);

yukiRouter.get(
  "/transactions",
  requireAuth,
  requireOrganization,
  requireActiveSubscription,
  validateQuery(DateRangeQuery),
  asyncHandler(async (req, res) => {
    const connector = await getConnectorForOrganization(req.organization!.id);
    const data = await connector.getTransactions(req.query as unknown as { from: string; to: string });
    res.json({ range: req.query, rows: data });
  }),
);

yukiRouter.get(
  "/debtors",
  requireAuth,
  requireOrganization,
  requireActiveSubscription,
  asyncHandler(async (req, res) => {
    const connector = await getConnectorForOrganization(req.organization!.id);
    res.json({ contacts: await connector.getDebtors() });
  }),
);

yukiRouter.get(
  "/creditors",
  requireAuth,
  requireOrganization,
  requireActiveSubscription,
  asyncHandler(async (req, res) => {
    const connector = await getConnectorForOrganization(req.organization!.id);
    res.json({ contacts: await connector.getCreditors() });
  }),
);

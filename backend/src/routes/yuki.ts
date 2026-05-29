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
import { applyVatMappings } from "../services/vat-mapping.service.js";
import { ConnectionKind } from "@prisma/client";
import { BadRequestError } from "../utils/errors.js";

export const yukiRouter = Router();

/** A connection lives on an entity, so an entity must be selected. */
function requireEntity(req: import("express").Request): string {
  const entityId = req.scope?.entityId;
  if (!entityId) throw new BadRequestError("Select an entity (x-entity-id) for connector operations");
  return entityId;
}

// Connector-specific credential payloads, discriminated by `kind`.
const ConnectionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("yuki"),
    accessKey: z.string().min(20, "Yuki access key looks too short"),
    administrationId: z.string().uuid("administrationId must be a UUID"),
    environment: z.enum(["PRODUCTION", "SANDBOX"]).default("PRODUCTION"),
  }),
  z.object({
    kind: z.literal("eboekhouden"),
    accessToken: z.string().min(20, "e-Boekhouden API-token lijkt te kort"),
    source: z.string().max(10).optional(),
  }),
]);

/** Store or update the connector credentials for the active entity. */
yukiRouter.put(
  "/connection",
  requireAuth,
  requireScope,
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateBody(ConnectionSchema),
  asyncHandler(async (req, res) => {
    const entityId = requireEntity(req);
    const body = req.body as z.infer<typeof ConnectionSchema>;

    const encryptedCredentials =
      body.kind === "yuki"
        ? encryptJson({ accessKey: body.accessKey, administrationId: body.administrationId })
        : encryptJson({ accessToken: body.accessToken, source: body.source });
    const dbKind = body.kind === "yuki" ? ConnectionKind.YUKI : ConnectionKind.EBOEKHOUDEN;
    const environment = body.kind === "yuki" ? body.environment : "PRODUCTION";

    const conn = await prisma.connection.upsert({
      where: { entityId },
      create: { entityId, kind: dbKind, encryptedCredentials, environment },
      update: { kind: dbKind, encryptedCredentials, environment },
    });

    await prisma.auditLog.create({
      data: {
        workspaceId: req.scope!.workspaceId,
        entityId,
        userId: req.user!.id,
        action: "connection.updated",
        metadata: { kind: dbKind },
      },
    });

    // Best-effort: adopt the administration's name from the connector so the
    // entity shows a recognizable label instead of a placeholder. Works for any
    // connector exposing getAdministrationName(); resolves to null (no change)
    // when the source can't unambiguously name the administration. Any hiccup
    // here must not fail the save.
    let administrationName: string | null = null;
    try {
      const connector = (await getConnectorForEntity(entityId)) as {
        getAdministrationName?: () => Promise<string | null>;
      };
      if (typeof connector.getAdministrationName === "function") {
        administrationName = await connector.getAdministrationName();
        if (administrationName) {
          await prisma.entity.update({ where: { id: entityId }, data: { name: administrationName } });
        }
      }
    } catch {
      /* name resolution is best-effort */
    }

    res.json({
      connection: { id: conn.id, kind: conn.kind, environment: conn.environment, updatedAt: conn.updatedAt },
      administrationName,
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
    await prisma.connection.deleteMany({ where: { entityId } });
    res.json({ ok: true });
  }),
);

yukiRouter.get(
  "/connection",
  requireAuth,
  requireScope,
  asyncHandler(async (req, res) => {
    const entityId = requireEntity(req);
    const conn = await prisma.connection.findUnique({ where: { entityId } });
    res.json({
      connection: conn
        ? {
            id: conn.id,
            kind: conn.kind,
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

    if (result.ok) {
      await prisma.connection
        .update({ where: { entityId }, data: { lastTestedAt: new Date() } })
        .catch(() => undefined);
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
    const entityId = requireEntity(req);
    const connector = await getConnectorForEntity(entityId);
    const data = await connector.getTransactions(req.query as unknown as { from: string; to: string });
    const rows = await applyVatMappings(data, req.scope!.workspaceId, entityId);
    res.json({ range: req.query, rows });
  }),
);

const OutstandingQuery = z.object({ type: z.enum(["debtor", "creditor"]).default("debtor") });

yukiRouter.get(
  "/outstanding",
  requireAuth,
  requireScope,
  requireActiveSubscription,
  validateQuery(OutstandingQuery),
  asyncHandler(async (req, res) => {
    const { type } = req.query as unknown as { type: "debtor" | "creditor" };
    const connector = await getConnectorForEntity(requireEntity(req));
    res.json({ items: await connector.getOutstanding(type) });
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

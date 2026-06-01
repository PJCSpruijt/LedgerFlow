import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { encryptJson } from "../utils/crypto.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  isPlatformAdmin,
  requireAuth,
  requireScope,
  requireScopeRole,
  SCOPE_ADMIN_ROLES,
} from "../middleware/auth.js";
import { requireActiveSubscription } from "../middleware/subscription.js";
import { getConnectorForEntity } from "../clients/connectors/registry.js";
import {
  cachedTrialBalance,
  cachedTransactions,
  cachedOutstanding,
  cachedDebtors,
  cachedCreditors,
} from "../services/connector-cache.service.js";
import { applyVatMappings } from "../services/vat-mapping.service.js";
import { applyRgsMappings } from "../services/rgs-mapping.service.js";
import { convert, prefetchRates } from "../services/fx.service.js";
import { ConnectionKind } from "@prisma/client";
import { BadRequestError, NotFoundError } from "../utils/errors.js";

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

/**
 * Workspace-wide overview of all administrations and their connection status
 * (no credentials). Filtered to the entities the user can actually reach
 * (workspace / group / entity memberships; platform admins see all).
 */
yukiRouter.get(
  "/connections",
  requireAuth,
  requireScope,
  asyncHandler(async (req, res) => {
    const workspaceId = req.scope!.workspaceId;
    const memberships = await prisma.membership.findMany({ where: { userId: req.user!.id } });
    const wsAccess =
      isPlatformAdmin(req) ||
      memberships.some((m) => m.scopeLevel === "WORKSPACE" && m.workspaceId === workspaceId);
    const groupIds = new Set(memberships.filter((m) => m.groupId).map((m) => m.groupId));
    const entIds = new Set(memberships.filter((m) => m.entityId).map((m) => m.entityId));

    const entities = await prisma.entity.findMany({
      where: { group: { workspaceId } },
      select: {
        id: true,
        name: true,
        groupId: true,
        group: { select: { name: true } },
        connection: {
          select: { kind: true, environment: true, lastTestedAt: true, lastSyncAt: true, updatedAt: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const visible = entities.filter((e) => wsAccess || groupIds.has(e.groupId) || entIds.has(e.id));
    res.json({
      connections: visible.map((e) => ({
        entityId: e.id,
        entityName: e.name,
        groupName: e.group.name,
        connection: e.connection,
      })),
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
  // Optional reporting currency for FX conversion (ignored by trial-balance).
  currency: z.string().length(3).optional(),
  // "1" bypasses the day-cache and re-fetches live from the connector.
  refresh: z.string().optional(),
});

yukiRouter.get(
  "/trial-balance",
  requireAuth,
  requireScope,
  requireActiveSubscription,
  validateQuery(DateRangeQuery),
  asyncHandler(async (req, res) => {
    const entityId = requireEntity(req);
    const q = req.query as unknown as { from: string; to: string; refresh?: string };
    const { data, fetchedAt } = await cachedTrialBalance(entityId, { from: q.from, to: q.to }, q.refresh === "1");
    const rows = await applyRgsMappings(data, req.scope!.workspaceId, entityId);
    res.json({ range: req.query, rows, cachedAt: fetchedAt });
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
    const q = req.query as unknown as { from: string; to: string; refresh?: string };
    const { data, fetchedAt } = await cachedTransactions(entityId, { from: q.from, to: q.to }, q.refresh === "1");
    const vatRows = await applyVatMappings(data, req.scope!.workspaceId, entityId);
    const rows = await applyRgsMappings(vatRows, req.scope!.workspaceId, entityId);

    // Convert every line to one reporting currency so subtotals are valid even
    // when a group mixes currencies. EUR-only data short-circuits (no FX calls).
    const reportingCurrency = ((req.query as { currency?: string }).currency || "EUR").toUpperCase();
    await prefetchRates(
      rows.map((r) => ({ date: r.date, from: (r.currency || reportingCurrency).toUpperCase() })),
      reportingCurrency,
    );
    for (const r of rows) {
      const from = (r.currency || reportingCurrency).toUpperCase();
      const conv = await convert(r.amount, from, reportingCurrency, r.date);
      if (conv != null) {
        r.reportingAmount = conv;
        r.reportingCurrency = reportingCurrency;
      } else {
        // No rate available → leave the amount in its own currency (unconverted).
        r.reportingAmount = r.amount;
        r.reportingCurrency = from;
      }
    }
    res.json({ range: req.query, reportingCurrency, rows, cachedAt: fetchedAt });
  }),
);

const OutstandingQuery = z.object({
  type: z.enum(["debtor", "creditor"]).default("debtor"),
  refresh: z.string().optional(),
});

yukiRouter.get(
  "/outstanding",
  requireAuth,
  requireScope,
  requireActiveSubscription,
  validateQuery(OutstandingQuery),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as { type: "debtor" | "creditor"; refresh?: string };
    const { data, fetchedAt } = await cachedOutstanding(requireEntity(req), q.type, q.refresh === "1");
    res.json({ items: data, cachedAt: fetchedAt });
  }),
);

const PdfQuery = z.object({ ref: z.string().min(1) });

yukiRouter.get(
  "/invoice-pdf",
  requireAuth,
  requireScope,
  requireActiveSubscription,
  validateQuery(PdfQuery),
  asyncHandler(async (req, res) => {
    const { ref } = req.query as unknown as { ref: string };
    const connector = await getConnectorForEntity(requireEntity(req));
    const doc = await connector.getInvoicePdf(ref);
    if (!doc) throw new NotFoundError("Geen factuur-PDF beschikbaar voor deze post");
    res.setHeader("Content-Type", doc.contentType);
    res.setHeader("Content-Disposition", `inline; filename="${doc.fileName.replace(/"/g, "")}"`);
    res.setHeader("Content-Length", String(doc.data.byteLength));
    res.end(doc.data);
  }),
);

yukiRouter.get(
  "/debtors",
  requireAuth,
  requireScope,
  requireActiveSubscription,
  asyncHandler(async (req, res) => {
    const { data, fetchedAt } = await cachedDebtors(requireEntity(req), req.query.refresh === "1");
    res.json({ contacts: data, cachedAt: fetchedAt });
  }),
);

yukiRouter.get(
  "/creditors",
  requireAuth,
  requireScope,
  requireActiveSubscription,
  asyncHandler(async (req, res) => {
    const { data, fetchedAt } = await cachedCreditors(requireEntity(req), req.query.refresh === "1");
    res.json({ contacts: data, cachedAt: fetchedAt });
  }),
);

import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateQuery } from "../middleware/validate.js";
import { requireAuth, requireScope, isPlatformAdmin } from "../middleware/auth.js";
import { requireModule } from "../middleware/subscription.js";
import { getWorkspaceEntitlements } from "../services/plan.service.js";
import { applyVatMappings } from "../services/vat-mapping.service.js";
import {
  tryGetConnectorForEntity,
  NO_CONNECTOR_MESSAGE,
} from "../clients/connectors/registry.js";
import {
  buildTransactionsWorkbook,
  buildTrialBalanceWorkbook,
  type ExportContext,
  type TransactionExportRow,
  type TrialBalanceExportRow,
} from "../services/export.service.js";
import { ForbiddenError, ModuleRequiredError, NotFoundError } from "../utils/errors.js";

export const exportRouter = Router();

// `entityIds` is an optional comma-separated list. Absent (or empty) means the
// whole workspace: every administration the caller is allowed to see.
const ExportQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entityIds: z.string().optional(),
});

type ExportQueryInput = z.infer<typeof ExportQuery>;

interface ResolvedEntity {
  id: string;
  name: string;
}

/**
 * Resolve which administrations this export should cover, enforcing access per
 * entity. Access to an entity is granted by a membership on the workspace (=> all
 * entities), the entity's group (=> that group's entities), or the entity itself.
 * Requesting an inaccessible administration is a hard error — we never silently
 * drop it, and never assume workspace membership implies entity access unless the
 * membership is actually at the workspace level.
 */
async function resolveAuthorizedEntities(
  req: import("express").Request,
  workspaceId: string,
  requestedIds: string[] | null,
): Promise<ResolvedEntity[]> {
  const all = await prisma.entity.findMany({
    where: { group: { workspaceId } },
    select: { id: true, name: true, groupId: true },
    orderBy: { name: "asc" },
  });

  let accessible: typeof all;
  if (isPlatformAdmin(req)) {
    accessible = all;
  } else {
    const groupIds = [...new Set(all.map((e) => e.groupId))];
    const entityIds = all.map((e) => e.id);
    const memberships = await prisma.membership.findMany({
      where: {
        userId: req.user!.id,
        OR: [
          { workspaceId },
          ...(groupIds.length ? [{ groupId: { in: groupIds } }] : []),
          ...(entityIds.length ? [{ entityId: { in: entityIds } }] : []),
        ],
      },
      select: { workspaceId: true, groupId: true, entityId: true },
    });
    const hasWorkspace = memberships.some((m) => m.workspaceId === workspaceId);
    if (hasWorkspace) {
      accessible = all;
    } else {
      const okGroups = new Set(memberships.map((m) => m.groupId).filter(Boolean) as string[]);
      const okEntities = new Set(memberships.map((m) => m.entityId).filter(Boolean) as string[]);
      accessible = all.filter((e) => okGroups.has(e.groupId) || okEntities.has(e.id));
    }
  }

  if (!requestedIds) {
    if (accessible.length === 0) {
      throw new ForbiddenError("No accessible administrations in this workspace");
    }
    return accessible.map(({ id, name }) => ({ id, name }));
  }

  const accessibleIds = new Set(accessible.map((e) => e.id));
  const denied = requestedIds.filter((id) => !accessibleIds.has(id));
  if (denied.length) {
    throw new ForbiddenError("No access to one or more selected administrations");
  }
  const wanted = new Set(requestedIds);
  return accessible.filter((e) => wanted.has(e.id)).map(({ id, name }) => ({ id, name }));
}

function parseEntityIds(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) return null;
  return ids;
}

function scopeLabel(entities: ResolvedEntity[], wholeWorkspace: boolean): string {
  if (entities.length === 1) return entities[0]!.name;
  if (wholeWorkspace) return `Hele werkruimte (${entities.length} administraties)`;
  return `${entities.length} administraties`;
}

/**
 * Combining more than one administration in a single export is gated behind the
 * MULTI_ADMIN module. The platform superuser is exempt. Run after the entity
 * list has been resolved.
 */
async function assertMultiAdminAllowed(
  req: import("express").Request,
  workspaceId: string,
  entityCount: number,
): Promise<void> {
  if (entityCount <= 1) return;
  if (isPlatformAdmin(req)) return;
  const ent = await getWorkspaceEntitlements(workspaceId);
  if (!ent.modules.includes("MULTI_ADMIN")) {
    throw new ModuleRequiredError(
      "Het combineren van meerdere administraties in één export vereist de module Multi-administratie. Upgrade je abonnement.",
      { module: "MULTI_ADMIN" },
    );
  }
}

interface EntityWithConnector {
  entity: ResolvedEntity;
  connector: import("../clients/connectors/interfaces/Connector.js").Connector;
}

/**
 * Pair each resolved administration with its connector. Administrations without
 * a connector configured are skipped — their names are returned in `skipped` so
 * a multi-administration export doesn't fail wholesale on one unlinked entity.
 * The exception: when exactly one administration was resolved, a missing
 * connector is a hard NotFoundError — a single-administration export with
 * nothing to export should report the problem, not return an empty workbook.
 * Authorization is already enforced upstream by resolveAuthorizedEntities.
 */
async function resolveConnectors(
  entities: ResolvedEntity[],
): Promise<{ pairs: EntityWithConnector[]; skipped: ResolvedEntity[] }> {
  const pairs: EntityWithConnector[] = [];
  const skipped: ResolvedEntity[] = [];
  for (const entity of entities) {
    const connector = await tryGetConnectorForEntity(entity.id);
    if (!connector) {
      if (entities.length === 1) throw new NotFoundError(NO_CONNECTOR_MESSAGE);
      skipped.push(entity);
      continue;
    }
    pairs.push({ entity, connector });
  }
  return { pairs, skipped };
}

/** Advertise skipped administrations on the response (CORS-exposed in app.ts). */
function setSkippedHeader(res: import("express").Response, skipped: ResolvedEntity[]): void {
  if (!skipped.length) return;
  // Names can contain non-ASCII (Dutch); encode each to keep the header valid.
  res.setHeader(
    "X-Skipped-Administrations",
    skipped.map((e) => encodeURIComponent(e.name)).join(","),
  );
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
  requireModule("EXPORTS"),
  validateQuery(ExportQuery),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as ExportQueryInput;
    const requestedIds = parseEntityIds(query.entityIds);
    const workspaceId = req.scope!.workspaceId;
    const entities = await resolveAuthorizedEntities(req, workspaceId, requestedIds);
    await assertMultiAdminAllowed(req, workspaceId, entities.length);
    const range = { from: query.from, to: query.to };

    const { pairs, skipped } = await resolveConnectors(entities);
    const rows: TrialBalanceExportRow[] = [];
    const connectorKinds = new Set<string>();
    for (const { entity, connector } of pairs) {
      connectorKinds.add(connector.kind);
      const lines = await connector.getTrialBalance(range);
      for (const line of lines) rows.push({ ...line, administration: entity.name });
    }

    const ctx: ExportContext = {
      scopeLabel: scopeLabel(entities, requestedIds === null),
      administrations: pairs.map((p) => p.entity.name),
      skippedAdministrations: skipped.map((e) => e.name),
      generatedAt: new Date(),
      from: range.from,
      to: range.to,
      connectorKinds: [...connectorKinds],
    };
    const buf = await buildTrialBalanceWorkbook(ctx, rows);

    await prisma.auditLog.create({
      data: {
        workspaceId,
        userId: req.user!.id,
        action: "export.trial-balance",
        metadata: {
          from: range.from,
          to: range.to,
          count: rows.length,
          entityIds: pairs.map((p) => p.entity.id),
          skippedEntityIds: skipped.map((e) => e.id),
        },
      },
    });
    setSkippedHeader(res, skipped);
    sendXlsx(res, buf, `ledgerflow-proefbalans-${range.from}_${range.to}.xlsx`);
  }),
);

exportRouter.get(
  "/transactions.xlsx",
  requireAuth,
  requireScope,
  requireModule("EXPORTS"),
  validateQuery(ExportQuery),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as ExportQueryInput;
    const requestedIds = parseEntityIds(query.entityIds);
    const workspaceId = req.scope!.workspaceId;
    const entities = await resolveAuthorizedEntities(req, workspaceId, requestedIds);
    await assertMultiAdminAllowed(req, workspaceId, entities.length);
    const range = { from: query.from, to: query.to };

    const { pairs, skipped } = await resolveConnectors(entities);
    const rows: TransactionExportRow[] = [];
    const connectorKinds = new Set<string>();
    for (const { entity, connector } of pairs) {
      connectorKinds.add(connector.kind);
      const lines = await connector.getTransactions(range);
      // Apply user-maintained VAT account mappings on top of connector inference.
      const mapped = await applyVatMappings(lines, workspaceId, entity.id);
      for (const line of mapped) rows.push({ ...line, administration: entity.name });
    }

    const ctx: ExportContext = {
      scopeLabel: scopeLabel(entities, requestedIds === null),
      administrations: pairs.map((p) => p.entity.name),
      skippedAdministrations: skipped.map((e) => e.name),
      generatedAt: new Date(),
      from: range.from,
      to: range.to,
      connectorKinds: [...connectorKinds],
    };
    const buf = await buildTransactionsWorkbook(ctx, rows);

    await prisma.auditLog.create({
      data: {
        workspaceId,
        userId: req.user!.id,
        action: "export.transactions",
        metadata: {
          from: range.from,
          to: range.to,
          count: rows.length,
          entityIds: pairs.map((p) => p.entity.id),
          skippedEntityIds: skipped.map((e) => e.id),
        },
      },
    });
    setSkippedHeader(res, skipped);
    sendXlsx(res, buf, `ledgerflow-mutaties-${range.from}_${range.to}.xlsx`);
  }),
);

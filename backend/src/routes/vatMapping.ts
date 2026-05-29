import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import {
  requireAuth,
  requireScope,
  requireScopeRole,
  SCOPE_ADMIN_ROLES,
} from "../middleware/auth.js";
import { getConnectorForEntity } from "../clients/connectors/registry.js";
import {
  applyVatMappings,
  deleteVatMapping,
  listVatMappings,
  requiredVatCodes,
  upsertVatMapping,
} from "../services/vat-mapping.service.js";
import { BadRequestError, NotFoundError } from "../utils/errors.js";

export const vatMappingRouter = Router();

/** All VAT mappings for the active workspace (entity-specific + workspace-wide). */
vatMappingRouter.get(
  "/",
  requireAuth,
  requireScope,
  asyncHandler(async (req, res) => {
    res.json({ mappings: await listVatMappings(req.scope!.workspaceId) });
  }),
);

const UpsertSchema = z.object({
  entityId: z.string().uuid().nullable().optional(),
  sourceVatCode: z.string().min(1).max(40),
  sourceLedgerAccountCode: z.string().max(40).optional(),
  targetLedgerCode: z.string().min(1).max(40),
});

/** Create or update a VAT mapping (keyed by scope + vat code + source ledger). */
vatMappingRouter.post(
  "/",
  requireAuth,
  requireScope,
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateBody(UpsertSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof UpsertSchema>;
    // Guard: an entity-specific mapping must reference an entity in this workspace.
    if (body.entityId) {
      const ent = await prisma.entity.findFirst({
        where: { id: body.entityId, group: { workspaceId: req.scope!.workspaceId } },
        select: { id: true },
      });
      if (!ent) throw new BadRequestError("Administratie hoort niet bij deze werkruimte");
    }
    const mapping = await upsertVatMapping(req.scope!.workspaceId, body);
    res.status(201).json({ mapping });
  }),
);

const IdParam = z.object({ id: z.string().uuid() });

vatMappingRouter.delete(
  "/:id",
  requireAuth,
  requireScope,
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof IdParam>;
    const ok = await deleteVatMapping(req.scope!.workspaceId, id);
    if (!ok) throw new NotFoundError("Mapping niet gevonden");
    res.status(204).end();
  }),
);

const RangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * Data Quality: VAT codes that still need a user mapping for the active
 * administration + period (after applying existing mappings). Drives the
 * "VAT account mapping required" view.
 */
vatMappingRouter.get(
  "/required",
  requireAuth,
  requireScope,
  validateQuery(RangeQuery),
  asyncHandler(async (req, res) => {
    const entityId = req.scope!.entityId;
    if (!entityId) throw new BadRequestError("Selecteer een administratie");
    const q = req.query as unknown as { from: string; to: string };
    const connector = await getConnectorForEntity(entityId);
    const lines = await connector.getTransactions(q);
    const mapped = await applyVatMappings(lines, req.scope!.workspaceId, entityId);
    res.json({ required: requiredVatCodes(mapped) });
  }),
);

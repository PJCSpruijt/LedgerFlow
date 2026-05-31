import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { requireAuth, requireScope, requireScopeRole, SCOPE_ADMIN_ROLES } from "../middleware/auth.js";
import { createApiKey, listApiKeys, revokeApiKey } from "../services/api-key.service.js";
import { BadRequestError, NotFoundError } from "../utils/errors.js";

/**
 * Management of Output-API keys for the active workspace (internal, JWT-auth,
 * admin only). These keys authenticate external clients against /api/v1.
 */
export const apiKeysRouter = Router();

apiKeysRouter.get(
  "/",
  requireAuth,
  requireScope,
  asyncHandler(async (req, res) => {
    res.json({ keys: await listApiKeys(req.scope!.workspaceId) });
  }),
);

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  entityId: z.string().uuid().nullable().optional(),
  rateLimitPerMin: z.coerce.number().int().min(1).max(10_000).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

apiKeysRouter.post(
  "/",
  requireAuth,
  requireScope,
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateBody(CreateSchema),
  asyncHandler(async (req, res) => {
    const workspaceId = req.scope!.workspaceId;
    const body = req.body as z.infer<typeof CreateSchema>;
    if (body.entityId) {
      const ent = await prisma.entity.findFirst({
        where: { id: body.entityId, group: { workspaceId } },
        select: { id: true },
      });
      if (!ent) throw new BadRequestError("Administratie hoort niet bij deze werkruimte");
    }
    const { raw, apiKey } = await createApiKey({
      workspaceId,
      name: body.name,
      entityId: body.entityId ?? null,
      rateLimitPerMin: body.rateLimitPerMin,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      createdByUserId: req.user!.id,
    });
    await prisma.auditLog.create({
      data: { workspaceId, userId: req.user!.id, action: "apikey.created", metadata: { id: apiKey.id, name: apiKey.name } },
    });
    // The raw key is returned exactly once — never retrievable again.
    res.status(201).json({
      apiKey: { id: apiKey.id, name: apiKey.name, prefix: apiKey.prefix },
      rawKey: raw,
    });
  }),
);

const IdParam = z.object({ id: z.string().uuid() });

apiKeysRouter.delete(
  "/:id",
  requireAuth,
  requireScope,
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof IdParam>;
    const ok = await revokeApiKey(req.scope!.workspaceId, id);
    if (!ok) throw new NotFoundError("API-sleutel niet gevonden of al ingetrokken");
    await prisma.auditLog.create({
      data: { workspaceId: req.scope!.workspaceId, userId: req.user!.id, action: "apikey.revoked", metadata: { id } },
    });
    res.json({ ok: true });
  }),
);

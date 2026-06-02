import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requireScope, requireScopeRole, SCOPE_ADMIN_ROLES } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validate.js";
import {
  listCanonicalRelations,
  setRelationOverride,
  renameCanonicalGroup,
  clearRelationOverride,
} from "../services/relation-canonical.service.js";

/**
 * Universal (canonical) relations: cross-administration dedup + manual mapping.
 * Read is available to any scoped user; mutations are admin-gated.
 */
export const relationsRouter = Router();

relationsRouter.use(requireAuth, requireScope);

relationsRouter.get(
  "/canonical",
  validateQuery(z.object({ scope: z.enum(["group", "workspace"]).optional() })),
  asyncHandler(async (req, res) => {
    const scope = String(req.query.scope ?? "");
    const groupId = scope === "workspace" ? null : req.scope!.groupId ?? null;
    res.json(await listCanonicalRelations(req.scope!.workspaceId, groupId));
  }),
);

const OverrideBody = z.object({
  entityId: z.string().min(1),
  relationId: z.string().min(1),
  relationName: z.string().nullable().optional(),
  canonicalKey: z.string().min(1).max(120),
  displayName: z.string().max(160).nullable().optional(),
  vatNumber: z.string().max(40).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
});

relationsRouter.post(
  "/override",
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateBody(OverrideBody),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof OverrideBody>;
    await setRelationOverride({
      workspaceId: req.scope!.workspaceId,
      entityId: b.entityId,
      relationId: b.relationId,
      relationName: b.relationName ?? null,
      canonicalKey: b.canonicalKey,
      displayName: b.displayName ?? null,
      vatNumber: b.vatNumber ?? null,
      email: b.email ?? null,
      userId: req.user?.id ?? null,
    });
    res.json({ ok: true });
  }),
);

const RenameBody = z.object({
  canonicalKey: z.string().min(1).max(120),
  displayName: z.string().min(1).max(160),
  vatNumber: z.string().max(40).nullable().optional(),
  email: z.string().max(160).nullable().optional(),
  scope: z.enum(["group", "workspace"]).optional(),
});

relationsRouter.post(
  "/rename",
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateBody(RenameBody),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof RenameBody>;
    const groupId = b.scope === "workspace" ? null : req.scope!.groupId ?? null;
    res.json(
      await renameCanonicalGroup({
        workspaceId: req.scope!.workspaceId,
        groupId,
        canonicalKey: b.canonicalKey,
        displayName: b.displayName,
        vatNumber: b.vatNumber ?? null,
        email: b.email ?? null,
        userId: req.user?.id ?? null,
      }),
    );
  }),
);

relationsRouter.delete(
  "/override",
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateQuery(z.object({ entityId: z.string().min(1), relationId: z.string().min(1) })),
  asyncHandler(async (req, res) => {
    const { entityId, relationId } = req.query as { entityId: string; relationId: string };
    const ok = await clearRelationOverride(req.scope!.workspaceId, entityId, relationId);
    res.json({ ok });
  }),
);

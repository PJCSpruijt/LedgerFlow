import { Router } from "express";
import { z } from "zod";
import { ScopeLevel, ScopedRole } from "@prisma/client";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { isPlatformAdmin, requireAuth, requireScope, requireScopeRole, SCOPE_ADMIN_ROLES } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import {
  listWorkspaceTeam,
  addWorkspaceMember,
  updateWorkspaceMembership,
  removeWorkspaceMembership,
} from "../services/team.service.js";

/**
 * Workspace-scoped team / role management. A workspace admin (WORKSPACE_ADMIN /
 * ACCOUNTANT_ADMIN / CLIENT_ADMIN) manages the roles of users inside their own
 * workspace. Every operation is bounded to req.scope.workspaceId by the service.
 */
export const teamRouter = Router();

teamRouter.use(requireAuth, requireScope, requireScopeRole(...SCOPE_ADMIN_ROLES));

teamRouter.get(
  "/members",
  asyncHandler(async (req, res) => {
    res.json(await listWorkspaceTeam(req.scope!.workspaceId));
  }),
);

const AddSchema = z.object({
  email: z.string().email("Ongeldig e-mailadres"),
  scopeLevel: z.nativeEnum(ScopeLevel),
  scopeId: z.string().uuid(),
  role: z.nativeEnum(ScopedRole),
});

teamRouter.post(
  "/members",
  validateBody(AddSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof AddSchema>;
    const out = await addWorkspaceMember({
      workspaceId: req.scope!.workspaceId,
      email: b.email,
      scopeLevel: b.scopeLevel,
      scopeId: b.scopeId,
      role: b.role,
      enforceLimit: !isPlatformAdmin(req),
    });
    res.status(201).json(out);
  }),
);

const IdParam = z.object({ id: z.string().uuid() });
const RoleSchema = z.object({ role: z.nativeEnum(ScopedRole) });

teamRouter.patch(
  "/members/:id",
  validateParams(IdParam),
  validateBody(RoleSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof IdParam>;
    res.json(await updateWorkspaceMembership(id, req.scope!.workspaceId, req.body.role));
  }),
);

teamRouter.delete(
  "/members/:id",
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof IdParam>;
    await removeWorkspaceMembership(id, req.scope!.workspaceId);
    res.status(204).end();
  }),
);

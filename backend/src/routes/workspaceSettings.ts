import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { requireAuth, requireScope, requireScopeRole, SCOPE_ADMIN_ROLES } from "../middleware/auth.js";

export const workspaceSettingsRouter = Router();

const DEFAULTS = { rgsEnabled: false, rgsRequired: false, rgsVersion: "3.5" };

/** Current workspace settings (defaults when none persisted yet). */
workspaceSettingsRouter.get(
  "/",
  requireAuth,
  requireScope,
  asyncHandler(async (req, res) => {
    const s = await prisma.workspaceSettings.findUnique({
      where: { workspaceId: req.scope!.workspaceId },
    });
    res.json({
      settings: s
        ? { rgsEnabled: s.rgsEnabled, rgsRequired: s.rgsRequired, rgsVersion: s.rgsVersion }
        : DEFAULTS,
    });
  }),
);

const UpdateSchema = z.object({
  rgsEnabled: z.boolean().optional(),
  rgsRequired: z.boolean().optional(),
  rgsVersion: z.string().min(1).max(16).optional(),
});

/** Update workspace settings (admin only). */
workspaceSettingsRouter.put(
  "/",
  requireAuth,
  requireScope,
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateBody(UpdateSchema),
  asyncHandler(async (req, res) => {
    const workspaceId = req.scope!.workspaceId;
    const body = req.body as z.infer<typeof UpdateSchema>;
    const s = await prisma.workspaceSettings.upsert({
      where: { workspaceId },
      create: { workspaceId, ...DEFAULTS, ...body },
      update: body,
    });
    await prisma.auditLog.create({
      data: {
        workspaceId,
        userId: req.user!.id,
        action: "workspace.settings.updated",
        metadata: { ...body },
      },
    });
    res.json({
      settings: { rgsEnabled: s.rgsEnabled, rgsRequired: s.rgsRequired, rgsVersion: s.rgsVersion },
    });
  }),
);

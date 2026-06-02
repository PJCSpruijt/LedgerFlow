import { Router } from "express";
import { z } from "zod";
import { ScopedRole, ScopeLevel } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import {
  requireAuth,
  requireScope,
  requireScopeRole,
  isPlatformAdmin,
  topRole,
  SCOPE_ADMIN_ROLES,
} from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";
import { ForbiddenError, NotFoundError } from "../utils/errors.js";
import { assertWithinLimit } from "../services/plan.service.js";
import { syncSubscriptionQuantity } from "../services/billing-control.service.js";

export const workspaceRouter = Router();

interface EntityNode {
  id: string;
  name: string;
  role: ScopedRole;
}
interface GroupNode {
  id: string;
  name: string;
  role: ScopedRole;
  entities: EntityNode[];
}
interface WorkspaceNode {
  id: string;
  name: string;
  type: string;
  role: ScopedRole;
  groups: GroupNode[];
}

/**
 * Build the Workspace > Group > Entity tree the user may see, with the user's
 * effective role at each node (memberships cascade downward: a workspace role
 * applies to its groups/entities, a group role to its entities). Platform admin
 * sees everything with WORKSPACE_ADMIN. Other users see only branches their
 * memberships reach (a workspace membership exposes the whole workspace; a
 * group/entity membership exposes only that branch).
 */
async function accessibleTree(userId: string, admin: boolean): Promise<WorkspaceNode[]> {
  const full = await prisma.workspace.findMany({
    include: { groups: { include: { entities: true }, orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  if (admin) {
    const A = ScopedRole.WORKSPACE_ADMIN;
    return full.map((ws) => ({
      id: ws.id,
      name: ws.name,
      type: ws.type,
      role: A,
      groups: ws.groups.map((g) => ({
        id: g.id,
        name: g.name,
        role: A,
        entities: g.entities.map((e) => ({ id: e.id, name: e.name, role: A })),
      })),
    }));
  }

  const memberships = await prisma.membership.findMany({ where: { userId } });
  const wsRoles = new Map<string, ScopedRole[]>();
  const grpRoles = new Map<string, ScopedRole[]>();
  const entRoles = new Map<string, ScopedRole[]>();
  const add = (m: Map<string, ScopedRole[]>, key: string, role: ScopedRole) => {
    const cur = m.get(key);
    if (cur) cur.push(role);
    else m.set(key, [role]);
  };
  for (const m of memberships) {
    if (m.workspaceId) add(wsRoles, m.workspaceId, m.role);
    else if (m.groupId) add(grpRoles, m.groupId, m.role);
    else if (m.entityId) add(entRoles, m.entityId, m.role);
  }

  const out: WorkspaceNode[] = [];
  for (const ws of full) {
    const wsr = wsRoles.get(ws.id) ?? [];
    const fullWs = wsr.length > 0;
    const groups: GroupNode[] = [];
    for (const g of ws.groups) {
      const gr = [...wsr, ...(grpRoles.get(g.id) ?? [])];
      const fullGrp = gr.length > 0;
      if (fullGrp) {
        groups.push({
          id: g.id,
          name: g.name,
          role: topRole(gr),
          entities: g.entities.map((e) => ({
            id: e.id,
            name: e.name,
            role: topRole([...gr, ...(entRoles.get(e.id) ?? [])]),
          })),
        });
      } else {
        const entities = g.entities
          .filter((e) => entRoles.has(e.id))
          .map((e) => ({ id: e.id, name: e.name, role: topRole(entRoles.get(e.id)!) }));
        if (entities.length) {
          groups.push({ id: g.id, name: g.name, role: topRole(entities.map((e) => e.role)), entities });
        }
      }
    }
    if (fullWs || groups.length) {
      out.push({ id: ws.id, name: ws.name, type: ws.type, role: topRole(wsr), groups });
    }
  }
  return out;
}

/** The full scope hierarchy the authenticated user can access. */
workspaceRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const workspaces = await accessibleTree(req.user!.id, isPlatformAdmin(req));
    res.json({ workspaces });
  }),
);

const CreateWorkspaceSchema = z.object({ name: z.string().min(1).max(120) });

/** Create a new workspace with a default group + entity; creator becomes WORKSPACE_ADMIN. */
workspaceRouter.post(
  "/",
  requireAuth,
  validateBody(CreateWorkspaceSchema),
  asyncHandler(async (req, res) => {
    const workspace = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.create({
        data: {
          name: req.body.name,
          groups: {
            create: { name: req.body.name, entities: { create: { name: req.body.name } } },
          },
        },
        include: { groups: { include: { entities: true } } },
      });
      await tx.membership.create({
        data: {
          userId: req.user!.id,
          scopeLevel: ScopeLevel.WORKSPACE,
          role: ScopedRole.WORKSPACE_ADMIN,
          workspaceId: ws.id,
        },
      });
      await tx.subscription.create({ data: { workspaceId: ws.id, status: "NONE" } });
      await tx.auditLog.create({
        data: { workspaceId: ws.id, userId: req.user!.id, action: "workspace.created" },
      });
      return ws;
    });
    res.status(201).json({ workspace });
  }),
);

const RenameSchema = z.object({ name: z.string().min(1).max(120) });

/** Rename the active workspace (selected via x-workspace-id). */
workspaceRouter.patch(
  "/current",
  requireAuth,
  requireScope,
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateBody(RenameSchema),
  asyncHandler(async (req, res) => {
    const ws = await prisma.workspace.update({
      where: { id: req.scope!.workspaceId },
      data: { name: req.body.name },
    });
    res.json({ workspace: { id: ws.id, name: ws.name, type: ws.type } });
  }),
);

const CreateGroupSchema = z.object({ name: z.string().min(1).max(120) });

/** Create a group in the active workspace. */
workspaceRouter.post(
  "/current/groups",
  requireAuth,
  requireScope,
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateBody(CreateGroupSchema),
  asyncHandler(async (req, res) => {
    const group = await prisma.group.create({
      data: { name: req.body.name, workspaceId: req.scope!.workspaceId },
    });
    res.status(201).json({ group: { id: group.id, name: group.name } });
  }),
);

const CreateEntitySchema = z.object({
  name: z.string().min(1).max(120),
  groupId: z.string().uuid(),
});

/** Create an entity under a group that belongs to the active workspace. */
workspaceRouter.post(
  "/current/entities",
  requireAuth,
  requireScope,
  requireScopeRole(...SCOPE_ADMIN_ROLES),
  validateBody(CreateEntitySchema),
  asyncHandler(async (req, res) => {
    const group = await prisma.group.findUnique({ where: { id: req.body.groupId } });
    if (!group) throw new NotFoundError("Group not found");
    if (group.workspaceId !== req.scope!.workspaceId) {
      throw new ForbiddenError("Group does not belong to this workspace");
    }
    if (!isPlatformAdmin(req)) await assertWithinLimit(req.scope!.workspaceId, "administrations");
    const entity = await prisma.entity.create({
      data: { name: req.body.name, groupId: group.id },
    });
    void syncSubscriptionQuantity(req.scope!.workspaceId);
    res.status(201).json({ entity: { id: entity.id, name: entity.name, groupId: entity.groupId } });
  }),
);

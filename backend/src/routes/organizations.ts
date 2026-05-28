import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { requireAuth, requireOrganization, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { validateBody } from "../middleware/validate.js";

export const organizationRouter = Router();

/** List organizations the authenticated user belongs to. */
organizationRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const memberships = await prisma.organizationUser.findMany({
      where: { userId: req.user!.id },
      include: {
        organization: { include: { subscription: true, yukiConnection: true } },
      },
    });
    res.json({
      organizations: memberships.map((m) => ({
        id: m.organization.id,
        name: m.organization.name,
        role: m.role,
        subscription: m.organization.subscription
          ? {
              plan: m.organization.subscription.plan,
              status: m.organization.subscription.status,
              validUntil: m.organization.subscription.validUntil,
            }
          : null,
        hasYukiConnection: Boolean(m.organization.yukiConnection),
      })),
    });
  }),
);

const CreateOrgSchema = z.object({ name: z.string().min(1).max(120) });

organizationRouter.post(
  "/",
  requireAuth,
  validateBody(CreateOrgSchema),
  asyncHandler(async (req, res) => {
    const org = await prisma.$transaction(async (tx) => {
      const o = await tx.organization.create({ data: { name: req.body.name } });
      await tx.organizationUser.create({
        data: { userId: req.user!.id, organizationId: o.id, role: "OWNER" },
      });
      await tx.subscription.create({ data: { organizationId: o.id, status: "NONE" } });
      return o;
    });
    res.status(201).json({ organization: org });
  }),
);

const UpdateOrgSchema = z.object({ name: z.string().min(1).max(120) });

organizationRouter.patch(
  "/current",
  requireAuth,
  requireOrganization,
  requireRole("ADMIN"),
  validateBody(UpdateOrgSchema),
  asyncHandler(async (req, res) => {
    const org = await prisma.organization.update({
      where: { id: req.organization!.id },
      data: { name: req.body.name },
    });
    res.json({ organization: org });
  }),
);

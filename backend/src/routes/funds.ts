import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.js";
import { validateBody, validateParams } from "../middleware/validate.js";
import { NotFoundError } from "../utils/errors.js";
import { createApiKey } from "../services/api-key.service.js";
import {
  listFunds,
  getFund,
  createFund,
  deleteFund,
  addHolding,
  removeHolding,
} from "../services/portfolio.service.js";

/**
 * Portfolio / PE fund management (#41) — platform-admin only. Funds, their
 * portfolio holdings (workspaces), and fund-scoped API keys for cross-tenant
 * read access through the Output API.
 */
export const fundsRouter = Router();

fundsRouter.use(requireAuth, requirePlatformAdmin);

fundsRouter.get("/", asyncHandler(async (_req, res) => res.json({ funds: await listFunds() })));

fundsRouter.post(
  "/",
  validateBody(z.object({ name: z.string().min(1).max(160) })),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createFund(req.body.name, req.user?.id ?? null));
  }),
);

const IdParam = z.object({ id: z.string().uuid() });

fundsRouter.get(
  "/:id",
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    const fund = await getFund(String(req.params.id));
    if (!fund) throw new NotFoundError("Fonds niet gevonden");
    res.json({ fund });
  }),
);

fundsRouter.delete(
  "/:id",
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    const ok = await deleteFund(String(req.params.id));
    if (!ok) throw new NotFoundError("Fonds niet gevonden");
    res.json({ ok: true });
  }),
);

fundsRouter.post(
  "/:id/holdings",
  validateParams(IdParam),
  validateBody(z.object({ workspaceId: z.string().uuid(), label: z.string().max(120).nullable().optional(), stakePct: z.number().min(0).max(100).nullable().optional() })),
  asyncHandler(async (req, res) => {
    const b = req.body as { workspaceId: string; label?: string | null; stakePct?: number | null };
    res.status(201).json(await addHolding({ fundId: String(req.params.id), workspaceId: b.workspaceId, label: b.label ?? null, stakePct: b.stakePct ?? null }));
  }),
);

fundsRouter.delete(
  "/holdings/:id",
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    const ok = await removeHolding(String(req.params.id));
    if (!ok) throw new NotFoundError("Holding niet gevonden");
    res.json({ ok: true });
  }),
);

// Fund-scoped API key (cross-tenant read access via the Output API).
fundsRouter.post(
  "/:id/keys",
  validateParams(IdParam),
  validateBody(z.object({ name: z.string().min(1).max(120), rateLimitPerMin: z.number().int().min(1).max(6000).optional() })),
  asyncHandler(async (req, res) => {
    const fund = await prisma.portfolioFund.findUnique({ where: { id: String(req.params.id) }, select: { id: true } });
    if (!fund) throw new NotFoundError("Fonds niet gevonden");
    const { raw, apiKey } = await createApiKey({ fundId: fund.id, name: req.body.name, rateLimitPerMin: req.body.rateLimitPerMin, createdByUserId: req.user?.id ?? null });
    res.status(201).json({ apiKey: { id: apiKey.id, name: apiKey.name, prefix: apiKey.prefix }, rawKey: raw });
  }),
);

fundsRouter.delete(
  "/keys/:id",
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    const r = await prisma.apiKey.updateMany({ where: { id: String(req.params.id), fundId: { not: null }, revokedAt: null }, data: { revokedAt: new Date() } });
    if (r.count === 0) throw new NotFoundError("Sleutel niet gevonden");
    res.json({ ok: true });
  }),
);

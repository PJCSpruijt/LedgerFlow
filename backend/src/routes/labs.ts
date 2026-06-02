import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { isPlatformAdmin, requireAuth, requireScope } from "../middleware/auth.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { ForbiddenError, NotFoundError } from "../utils/errors.js";
import {
  listIdeas,
  suggestSimilar,
  createIdea,
  toggleVote,
  getIdea,
  addComment,
  setIdeaStatus,
  LAB_STATUSES,
  LAB_CATEGORIES,
} from "../services/labs.service.js";

/** FIN//HUB Labs — feature voting & roadmap. Read/vote/comment for any scoped user. */
export const labsRouter = Router();

labsRouter.use(requireAuth, requireScope);

labsRouter.get(
  "/ideas",
  validateQuery(z.object({ status: z.enum(LAB_STATUSES).optional(), category: z.enum(LAB_CATEGORIES).optional(), sort: z.enum(["top", "new"]).optional() })),
  asyncHandler(async (req, res) => {
    const q = req.query as { status?: string; category?: string; sort?: "top" | "new" };
    res.json(await listIdeas({ userId: req.user?.id ?? null, status: q.status, category: q.category, sort: q.sort }));
  }),
);

labsRouter.get(
  "/ideas/similar",
  validateQuery(z.object({ title: z.string().min(1).max(160) })),
  asyncHandler(async (req, res) => {
    res.json({ similar: await suggestSimilar(String(req.query.title)) });
  }),
);

const CreateSchema = z.object({
  title: z.string().min(4).max(160),
  description: z.string().min(1).max(4000),
  category: z.enum(LAB_CATEGORIES).optional(),
});

labsRouter.post(
  "/ideas",
  validateBody(CreateSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof CreateSchema>;
    const out = await createIdea({
      title: b.title,
      description: b.description,
      category: b.category ?? "OTHER",
      workspaceId: req.scope?.workspaceId ?? null,
      userId: req.user?.id ?? null,
    });
    res.status(201).json(out);
  }),
);

const IdParam = z.object({ id: z.string().uuid() });

labsRouter.get(
  "/ideas/:id",
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    const idea = await getIdea(String(req.params.id), req.user?.id ?? null);
    if (!idea) throw new NotFoundError("Idee niet gevonden");
    res.json({ idea });
  }),
);

labsRouter.post(
  "/ideas/:id/vote",
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    if (!req.user?.id) throw new ForbiddenError("Inloggen vereist om te stemmen");
    res.json(await toggleVote(String(req.params.id), req.user.id));
  }),
);

labsRouter.post(
  "/ideas/:id/comments",
  validateParams(IdParam),
  validateBody(z.object({ body: z.string().min(1).max(2000) })),
  asyncHandler(async (req, res) => {
    const out = await addComment(String(req.params.id), req.user?.id ?? null, req.body.body);
    if (!out) throw new NotFoundError("Idee niet gevonden");
    res.status(201).json(out);
  }),
);

labsRouter.patch(
  "/ideas/:id",
  validateParams(IdParam),
  validateBody(z.object({ status: z.enum(LAB_STATUSES) })),
  asyncHandler(async (req, res) => {
    if (!isPlatformAdmin(req)) throw new ForbiddenError("Alleen platformbeheer kan de status wijzigen");
    const ok = await setIdeaStatus(String(req.params.id), req.body.status);
    if (!ok) throw new NotFoundError("Idee niet gevonden");
    res.json({ ok: true });
  }),
);

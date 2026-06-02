import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { requireAuth, requirePlatformAdmin } from "../middleware/auth.js";
import { validateBody, validateParams, validateQuery } from "../middleware/validate.js";
import { NotFoundError } from "../utils/errors.js";
import {
  reportIncident,
  listIncidents,
  getIncident,
  updateIncident,
  INCIDENT_STATUSES,
  INCIDENT_SEVERITIES,
} from "../services/incident.service.js";

/**
 * Incident reporting & central error management. Reporting is open to any
 * authenticated user (the "Meld probleem" button); triage/management is
 * platform-admin only.
 */
export const incidentsRouter = Router();

const ReportSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  route: z.string().max(300).nullable().optional(),
  module: z.string().max(80).nullable().optional(),
  errorKey: z.string().max(200).nullable().optional(),
  context: z.record(z.unknown()).nullable().optional(),
});

// Report — any authenticated user.
incidentsRouter.post(
  "/",
  requireAuth,
  validateBody(ReportSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof ReportSchema>;
    const workspaceId = (req.headers["x-workspace-id"] as string | undefined) ?? null;
    const result = await reportIncident({
      title: b.title,
      description: b.description ?? null,
      severity: b.severity,
      route: b.route ?? null,
      module: b.module ?? null,
      errorKey: b.errorKey ?? null,
      context: b.context ?? null,
      workspaceId,
      userId: req.user?.id ?? null,
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  }),
);

// Triage / management — platform admin only.
incidentsRouter.use(requireAuth, requirePlatformAdmin);

incidentsRouter.get(
  "/",
  validateQuery(z.object({ status: z.enum(INCIDENT_STATUSES).optional(), severity: z.enum(INCIDENT_SEVERITIES).optional() })),
  asyncHandler(async (req, res) => {
    const q = req.query as { status?: string; severity?: string };
    res.json(await listIncidents({ status: q.status, severity: q.severity }));
  }),
);

const IdParam = z.object({ id: z.string().uuid() });

incidentsRouter.get(
  "/:id",
  validateParams(IdParam),
  asyncHandler(async (req, res) => {
    const inc = await getIncident(String(req.params.id));
    if (!inc) throw new NotFoundError("Incident niet gevonden");
    res.json({ incident: inc });
  }),
);

const UpdateSchema = z.object({
  status: z.enum(INCIDENT_STATUSES).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  resolution: z.string().max(2000).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
});

incidentsRouter.patch(
  "/:id",
  validateParams(IdParam),
  validateBody(UpdateSchema),
  asyncHandler(async (req, res) => {
    const b = req.body as z.infer<typeof UpdateSchema>;
    const ok = await updateIncident({ id: String(req.params.id), ...b, userId: req.user?.id ?? null });
    if (!ok) throw new NotFoundError("Incident niet gevonden");
    res.json({ ok: true });
  }),
);

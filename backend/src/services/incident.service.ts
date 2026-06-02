import { createHash } from "node:crypto";
import { prisma } from "../config/prisma.js";

/**
 * Smart incident reporting & central error management (#28).
 *
 * A reported problem is deduplicated by a deterministic fingerprint
 * (route + module + errorKey/normalized title), so the same issue reported many
 * times increments ONE incident ("dit probleem is al bekend") instead of
 * spawning duplicates. Each report is recorded as an IncidentEvent; the incident
 * moves through a status lifecycle and can be re-opened by a new occurrence.
 */

export const INCIDENT_STATUSES = [
  "NEW",
  "ACKNOWLEDGED",
  "INVESTIGATING",
  "FIX_IN_PROGRESS",
  "DEPLOYED",
  "RESOLVED",
  "CLOSED",
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
export type IncidentSeverity = (typeof INCIDENT_SEVERITIES)[number];

const CLOSED_STATES: IncidentStatus[] = ["RESOLVED", "CLOSED"];

const normalize = (s: string): string =>
  s.toLowerCase().replace(/[0-9a-f]{8,}/g, "#").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

function fingerprintOf(input: { route?: string | null; module?: string | null; errorKey?: string | null; title: string }): string {
  const basis = [input.route ?? "", input.module ?? "", input.errorKey ? input.errorKey : normalize(input.title)].join("|");
  return createHash("sha256").update(basis).digest("hex").slice(0, 32);
}

export interface ReportInput {
  title: string;
  description?: string | null;
  severity?: IncidentSeverity;
  route?: string | null;
  module?: string | null;
  errorKey?: string | null;
  /** Auto-captured context (browser, scope ids, recent actions…). Never secrets. */
  context?: Record<string, unknown> | null;
  workspaceId?: string | null;
  userId: string | null;
}

export interface ReportResult {
  incidentId: string;
  duplicate: boolean;
  status: IncidentStatus;
  occurrenceCount: number;
  message: string;
}

export async function reportIncident(input: ReportInput): Promise<ReportResult> {
  const title = input.title.trim().slice(0, 200) || "Onbekend probleem";
  const fingerprint = fingerprintOf({ route: input.route, module: input.module, errorKey: input.errorKey, title });
  const now = new Date();

  const existing = await prisma.incident.findUnique({ where: { fingerprint } });
  if (existing) {
    const reopened = CLOSED_STATES.includes(existing.status as IncidentStatus);
    const updated = await prisma.incident.update({
      where: { id: existing.id },
      data: {
        occurrenceCount: { increment: 1 },
        reporterCount: { increment: input.userId && input.userId !== existing.reportedByUserId ? 1 : 0 },
        lastSeenAt: now,
        status: reopened ? "ACKNOWLEDGED" : existing.status,
      },
    });
    await prisma.incidentEvent.create({
      data: { incidentId: existing.id, kind: "REPORTED", userId: input.userId, message: input.description ?? null, context: (input.context ?? undefined) as never },
    });
    return {
      incidentId: existing.id,
      duplicate: true,
      status: updated.status as IncidentStatus,
      occurrenceCount: updated.occurrenceCount,
      message: reopened
        ? "Dit probleem was opgelost maar is opnieuw opgetreden — het is heropend en wordt opnieuw bekeken."
        : "Dit probleem is al bekend en in onderzoek. Je melding is toegevoegd.",
    };
  }

  const created = await prisma.incident.create({
    data: {
      fingerprint,
      title,
      description: input.description ?? null,
      severity: input.severity ?? "MEDIUM",
      route: input.route ?? null,
      module: input.module ?? null,
      errorKey: input.errorKey ?? null,
      context: (input.context ?? undefined) as never,
      workspaceId: input.workspaceId ?? null,
      reportedByUserId: input.userId,
      firstSeenAt: now,
      lastSeenAt: now,
      events: { create: { kind: "REPORTED", userId: input.userId, message: input.description ?? null, context: (input.context ?? undefined) as never } },
    },
  });
  return { incidentId: created.id, duplicate: false, status: "NEW", occurrenceCount: 1, message: "Bedankt — je melding is geregistreerd." };
}

export interface IncidentListItem {
  id: string;
  title: string;
  severity: string;
  status: string;
  route: string | null;
  module: string | null;
  occurrenceCount: number;
  reporterCount: number;
  workspaceId: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export async function listIncidents(filter: { status?: string; severity?: string }): Promise<{ incidents: IncidentListItem[]; counts: Record<string, number> }> {
  const where: { status?: string; severity?: string } = {};
  if (filter.status) where.status = filter.status;
  if (filter.severity) where.severity = filter.severity;
  const rows = await prisma.incident.findMany({ where, orderBy: [{ lastSeenAt: "desc" }], take: 500 });
  const all = await prisma.incident.groupBy({ by: ["status"], _count: true });
  const counts: Record<string, number> = {};
  for (const g of all) counts[g.status] = g._count;
  return {
    incidents: rows.map((r) => ({
      id: r.id,
      title: r.title,
      severity: r.severity,
      status: r.status,
      route: r.route,
      module: r.module,
      occurrenceCount: r.occurrenceCount,
      reporterCount: r.reporterCount,
      workspaceId: r.workspaceId,
      firstSeenAt: r.firstSeenAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
    })),
    counts,
  };
}

export async function getIncident(id: string) {
  const inc = await prisma.incident.findUnique({
    where: { id },
    include: { events: { orderBy: { createdAt: "desc" }, take: 100 } },
  });
  if (!inc) return null;
  return {
    ...inc,
    firstSeenAt: inc.firstSeenAt.toISOString(),
    lastSeenAt: inc.lastSeenAt.toISOString(),
    resolvedAt: inc.resolvedAt ? inc.resolvedAt.toISOString() : null,
    createdAt: inc.createdAt.toISOString(),
    updatedAt: inc.updatedAt.toISOString(),
    events: inc.events.map((e) => ({ id: e.id, kind: e.kind, userId: e.userId, message: e.message, context: e.context, createdAt: e.createdAt.toISOString() })),
  };
}

/** Update status / severity / resolution; logs a STATUS or NOTE event. */
export async function updateIncident(input: {
  id: string;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  resolution?: string | null;
  note?: string | null;
  userId: string | null;
}): Promise<{ ok: true } | null> {
  const inc = await prisma.incident.findUnique({ where: { id: input.id } });
  if (!inc) return null;
  const data: Record<string, unknown> = {};
  if (input.status) {
    data.status = input.status;
    if (CLOSED_STATES.includes(input.status) && !inc.resolvedAt) data.resolvedAt = new Date();
    if (!CLOSED_STATES.includes(input.status)) data.resolvedAt = null;
  }
  if (input.severity) data.severity = input.severity;
  if (input.resolution !== undefined) data.resolution = input.resolution;

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.incident.update({ where: { id: input.id }, data });
    if (input.status || input.severity) {
      await tx.incidentEvent.create({
        data: { incidentId: input.id, kind: "STATUS", userId: input.userId, message: `${input.status ? `status → ${input.status}` : ""}${input.severity ? ` severity → ${input.severity}` : ""}`.trim() },
      });
    }
    if (input.note) {
      await tx.incidentEvent.create({ data: { incidentId: input.id, kind: "NOTE", userId: input.userId, message: input.note } });
    }
  });
  return { ok: true };
}

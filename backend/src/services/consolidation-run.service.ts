import { prisma } from "../config/prisma.js";
import { consolidate } from "./consolidation.service.js";

/**
 * Consolidation runs: freeze a computed consolidation as a reproducible
 * snapshot. The full result (leaves, eliminations, imbalances, entities) is
 * stored so the reporting position survives later changes to the live data.
 */

export interface CreateRunInput {
  workspaceId: string;
  groupId: string | null;
  scope: "group" | "workspace";
  from: string;
  to: string;
  currency: string;
  eliminate: boolean;
  label: string;
  userId: string | null;
}

export async function createConsolidationRun(input: CreateRunInput) {
  const result = await consolidate({
    workspaceId: input.workspaceId,
    groupId: input.scope === "workspace" ? null : input.groupId,
    from: input.from,
    to: input.to,
    currency: input.currency,
    eliminate: input.eliminate,
  });
  const run = await prisma.consolidationRun.create({
    data: {
      workspaceId: input.workspaceId,
      groupId: input.scope === "workspace" ? null : input.groupId,
      label: input.label.trim() || `Consolidatie ${input.from} t/m ${input.to}`,
      scope: input.scope,
      fromDate: input.from,
      toDate: input.to,
      currency: input.currency,
      eliminate: input.eliminate,
      entityCount: result.includedEntities.length,
      snapshot: result as unknown as object,
      createdByUserId: input.userId,
    },
  });
  return run;
}

/** List runs for a workspace (newest first), without the heavy snapshot blob. */
export async function listConsolidationRuns(workspaceId: string) {
  return prisma.consolidationRun.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      scope: true,
      groupId: true,
      fromDate: true,
      toDate: true,
      currency: true,
      eliminate: true,
      entityCount: true,
      createdAt: true,
    },
  });
}

/** Fetch one run incl. its stored snapshot, scoped to the workspace. */
export async function getConsolidationRun(workspaceId: string, id: string) {
  return prisma.consolidationRun.findFirst({ where: { id, workspaceId } });
}

/** Delete a run, scoped to the workspace. Returns whether a row was removed. */
export async function deleteConsolidationRun(workspaceId: string, id: string): Promise<boolean> {
  const r = await prisma.consolidationRun.deleteMany({ where: { id, workspaceId } });
  return r.count > 0;
}

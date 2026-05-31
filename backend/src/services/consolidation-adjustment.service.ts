import { prisma } from "../config/prisma.js";
import { resolveRgsVersion } from "./rgs-mapping.service.js";
import { convert } from "./fx.service.js";
import type { ConsolLeafRow } from "./consolidation.service.js";

/**
 * Manual consolidation corrections: double-entry journals (debit RGS / credit
 * RGS) that the automatic intercompany elimination can't infer. Applied on top
 * of the consolidated figures for any period covering their effective date.
 */

export interface CreateAdjustmentInput {
  workspaceId: string;
  groupId: string | null;
  description: string;
  debitRgsCode: string;
  creditRgsCode: string;
  amount: number;
  currency: string;
  effectiveDate: string;
  userId: string | null;
}

export async function listAdjustments(workspaceId: string, groupId: string | null) {
  return prisma.consolidationAdjustment.findMany({
    where: { workspaceId, ...(groupId ? { OR: [{ groupId }, { groupId: null }] } : {}) },
    orderBy: { effectiveDate: "desc" },
  });
}

export async function createAdjustment(input: CreateAdjustmentInput) {
  return prisma.consolidationAdjustment.create({
    data: {
      workspaceId: input.workspaceId,
      groupId: input.groupId,
      description: input.description.trim(),
      debitRgsCode: input.debitRgsCode,
      creditRgsCode: input.creditRgsCode,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      effectiveDate: input.effectiveDate,
      createdByUserId: input.userId,
    },
  });
}

export async function deleteAdjustment(workspaceId: string, id: string): Promise<boolean> {
  const r = await prisma.consolidationAdjustment.deleteMany({ where: { id, workspaceId } });
  return r.count > 0;
}

/**
 * Manual-correction leaves for a consolidation scope/period: two leaves per
 * adjustment (debit + credit), keyed to their RGS leaf with full hoofdrubriek
 * metadata so they slot into the right place in the statements/worksheet.
 */
export async function getAdjustmentLeaves(
  workspaceId: string,
  groupId: string | null,
  from: string,
  to: string,
  currency: string,
): Promise<ConsolLeafRow[]> {
  const adjustments = await prisma.consolidationAdjustment.findMany({
    where: {
      workspaceId,
      effectiveDate: { gte: from, lte: to },
      // Group consolidation: this group + workspace-wide. Workspace consolidation: workspace-wide only.
      ...(groupId ? { OR: [{ groupId }, { groupId: null }] } : { groupId: null }),
    },
    orderBy: { effectiveDate: "asc" },
  });
  if (adjustments.length === 0) return [];

  const version = await resolveRgsVersion(workspaceId);
  const codes = [...new Set(adjustments.flatMap((a) => [a.debitRgsCode, a.creditRgsCode]))];
  const leafRows = await prisma.rgsAccount.findMany({
    where: { version, code: { in: codes } },
    select: { code: true, description: true, isProfitLoss: true },
  });
  const leafMeta = new Map(leafRows.map((r) => [r.code, r]));
  const groupCodeOf = (c: string) => (c.length >= 4 ? c.slice(0, 4) : c);
  const groupRows = await prisma.rgsAccount.findMany({
    where: { version, code: { in: [...new Set(codes.map(groupCodeOf))] } },
    select: { code: true, description: true, referentienummer: true, dc: true },
  });
  const groupMeta = new Map(groupRows.map((r) => [r.code, r]));

  const out: ConsolLeafRow[] = [];
  for (const a of adjustments) {
    const amt = (await convert(a.amount, a.currency.toUpperCase(), currency, a.effectiveDate)) ?? a.amount;
    for (const leg of [
      { code: a.debitRgsCode, sign: 1, tag: "D" },
      { code: a.creditRgsCode, sign: -1, tag: "C" },
    ] as const) {
      const lm = leafMeta.get(leg.code);
      const gc = groupCodeOf(leg.code);
      const gm = groupMeta.get(gc);
      out.push({
        statement: lm?.isProfitLoss ? "PNL" : "BALANCE",
        rgsGroupCode: gc,
        rgsGroupName: gm?.description ?? gc,
        rgsGroupDc: gm?.dc ?? null,
        rgsGroupOrder: gm?.referentienummer ?? null,
        key: `ADJ:${a.id}:${leg.tag}`,
        rgsCode: leg.code,
        description: `Correctie — ${a.description}`,
        unmapped: false,
        isElimination: true,
        isAdjustment: true,
        total: leg.sign * amt,
        byEntity: [],
      });
    }
  }
  return out;
}

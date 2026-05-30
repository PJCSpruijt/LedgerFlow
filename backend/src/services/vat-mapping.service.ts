import { prisma } from "../config/prisma.js";
import type { TransactionLine } from "../clients/connectors/interfaces/Connector.js";

/**
 * VAT account mapping resolution layer.
 *
 * The connector emits generated VAT lines with a `mappingConfidence` of INFERRED
 * (resolved via ledger category) or REQUIRED (could not resolve). This layer
 * applies the user-maintained mappings on top — user mappings ALWAYS win and are
 * never overwritten by connector inference. Entity-specific mappings take
 * precedence over workspace-wide ones.
 */

export async function listVatMappings(workspaceId: string) {
  return prisma.vatMapping.findMany({
    where: { workspaceId },
    orderBy: [{ entityId: "asc" }, { sourceVatCode: "asc" }],
  });
}

export async function upsertVatMapping(
  workspaceId: string,
  input: {
    entityId?: string | null;
    sourceVatCode: string;
    sourceLedgerAccountCode?: string | null;
    targetLedgerCode: string;
  },
) {
  const entityId = input.entityId ?? null;
  const sourceLedgerAccountCode = input.sourceLedgerAccountCode ?? "";
  const existing = await prisma.vatMapping.findFirst({
    where: { workspaceId, entityId, sourceVatCode: input.sourceVatCode, sourceLedgerAccountCode },
  });
  if (existing) {
    return prisma.vatMapping.update({
      where: { id: existing.id },
      data: { targetLedgerCode: input.targetLedgerCode },
    });
  }
  return prisma.vatMapping.create({
    data: {
      workspaceId,
      entityId,
      sourceVatCode: input.sourceVatCode,
      sourceLedgerAccountCode,
      targetLedgerCode: input.targetLedgerCode,
    },
  });
}

export async function deleteVatMapping(workspaceId: string, id: string): Promise<boolean> {
  const row = await prisma.vatMapping.findUnique({ where: { id } });
  if (!row || row.workspaceId !== workspaceId) return false;
  await prisma.vatMapping.delete({ where: { id } });
  return true;
}

/**
 * Apply user-maintained VAT mappings to a connector's transaction lines.
 * Returns a NEW array (input lines are treated as immutable). Only generated VAT
 * lines with a `vatCode` are affected; matched lines get the mapped target
 * account, `mappingConfidence = EXACT`, and `sourceAccountKnown = true`.
 */
export async function applyVatMappings(
  lines: TransactionLine[],
  workspaceId: string,
  entityId: string,
): Promise<TransactionLine[]> {
  const mappings = await prisma.vatMapping.findMany({
    where: { workspaceId, OR: [{ entityId: null }, { entityId }] },
  });
  if (mappings.length === 0) return lines;

  // Aggregated VAT lines carry no source ledger code, so only general mappings
  // (sourceLedgerAccountCode = "") apply here; entity-specific beats workspace.
  const entityMap = new Map<string, string>();
  const workspaceMap = new Map<string, string>();
  for (const m of mappings) {
    if (m.sourceLedgerAccountCode !== "") continue;
    if (m.entityId === entityId) entityMap.set(m.sourceVatCode, m.targetLedgerCode);
    else if (m.entityId === null) workspaceMap.set(m.sourceVatCode, m.targetLedgerCode);
  }

  return lines.map((l) => {
    if (!l.generatedByConnector || !l.vatCode) return l;
    const target = entityMap.get(l.vatCode) ?? workspaceMap.get(l.vatCode);
    if (!target) return l;
    return {
      ...l,
      glAccountCode: target,
      sourceAccountKnown: true,
      mappingConfidence: "EXACT" as const,
    };
  });
}

export interface RequiredVatCode {
  vatCode: string;
  count: number;
  amount: number;
}

/** Distinct VAT codes whose account is still unresolved (REQUIRED) after mapping. */
export function requiredVatCodes(lines: TransactionLine[]): RequiredVatCode[] {
  const byCode = new Map<string, RequiredVatCode>();
  for (const l of lines) {
    if (l.mappingConfidence !== "REQUIRED") continue;
    const code = l.vatCode ?? "(onbekend)";
    const cur = byCode.get(code) ?? { vatCode: code, count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += l.amount;
    byCode.set(code, cur);
  }
  return [...byCode.values()];
}

import { prisma } from "../config/prisma.js";
import { tryGetConnectorForEntity } from "../clients/connectors/registry.js";

/**
 * Intercompany relation mapping. A relation (debtor/creditor) inside one
 * administration can BE another administration in the same workspace; marking
 * that lets consolidation eliminate the mutual receivable/payable balances.
 */

/** Normalize a company name for fuzzy matching (drop legal form + punctuation). */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(b\.?v\.?|n\.?v\.?|holding|group|groep|gmbh|ltd|inc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface IcRelation {
  relationId: string;
  relationName: string;
  relationCode: string | null;
  isDebtor: boolean;
  isCreditor: boolean;
  /** Currently mapped counterparty entity id, or null. */
  counterpartyEntityId: string | null;
  /** Suggested counterparty entity id from name matching, or null. */
  suggestedEntityId: string | null;
}

export interface IcEntityBlock {
  entityId: string;
  entityName: string;
  relations: IcRelation[];
}

export interface IcListResult {
  /** All entities in scope — candidates a relation can be mapped to. */
  entities: { id: string; name: string }[];
  blocks: IcEntityBlock[];
  warnings: string[];
}

/** Entities in the scope (group, or whole workspace). */
async function scopeEntities(workspaceId: string, groupId: string | null) {
  return prisma.entity.findMany({
    where: groupId ? { groupId, group: { workspaceId } } : { group: { workspaceId } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** List every relation per administration with its mapping + a suggestion. */
export async function listIntercompany(workspaceId: string, groupId: string | null): Promise<IcListResult> {
  const entities = await scopeEntities(workspaceId, groupId);
  const warnings: string[] = [];
  const existing = await prisma.intercompanyRelation.findMany({
    where: { entityId: { in: entities.map((e) => e.id) } },
    select: { entityId: true, relationId: true, counterpartyEntityId: true },
  });
  const mapByEntity = new Map<string, Map<string, string>>();
  for (const m of existing) {
    const inner = mapByEntity.get(m.entityId) ?? new Map<string, string>();
    inner.set(m.relationId, m.counterpartyEntityId);
    mapByEntity.set(m.entityId, inner);
  }
  // Pre-normalize candidate entity names for suggestion matching.
  const cand = entities.map((e) => ({ id: e.id, name: e.name, n: norm(e.name) }));

  const blocks: IcEntityBlock[] = [];
  for (const ent of entities) {
    const connector = await tryGetConnectorForEntity(ent.id);
    if (!connector) {
      blocks.push({ entityId: ent.id, entityName: ent.name, relations: [] });
      continue;
    }
    try {
      const [debtors, creditors] = await Promise.all([connector.getDebtors(), connector.getCreditors()]);
      const merged = new Map<string, { name: string; code: string | null; d: boolean; c: boolean }>();
      for (const x of debtors) {
        const e = merged.get(x.id) ?? { name: x.name, code: x.code, d: false, c: false };
        e.d = true;
        merged.set(x.id, e);
      }
      for (const x of creditors) {
        const e = merged.get(x.id) ?? { name: x.name, code: x.code, d: false, c: false };
        e.c = true;
        merged.set(x.id, e);
      }
      const mapped = mapByEntity.get(ent.id);
      const relations: IcRelation[] = [...merged.entries()].map(([relationId, v]) => {
        const rn = norm(v.name);
        // Suggest another entity (never itself) whose normalized name matches.
        const match = cand.find((c) => c.id !== ent.id && c.n && (c.n === rn || rn.includes(c.n) || c.n.includes(rn)));
        return {
          relationId,
          relationName: v.name,
          relationCode: v.code,
          isDebtor: v.d,
          isCreditor: v.c,
          counterpartyEntityId: mapped?.get(relationId) ?? null,
          suggestedEntityId: match?.id ?? null,
        };
      });
      relations.sort((a, b) => a.relationName.localeCompare(b.relationName));
      blocks.push({ entityId: ent.id, entityName: ent.name, relations });
    } catch (e) {
      warnings.push(`${ent.name}: relaties konden niet worden opgehaald (${e instanceof Error ? e.message : "fout"}).`);
      blocks.push({ entityId: ent.id, entityName: ent.name, relations: [] });
    }
  }
  return { entities: entities.map((e) => ({ id: e.id, name: e.name })), blocks, warnings };
}

/** Set (or clear, when counterpartyEntityId is null) an intercompany mapping. */
export async function setIntercompany(input: {
  workspaceId: string;
  entityId: string;
  relationId: string;
  relationCode: string | null;
  relationName: string | null;
  counterpartyEntityId: string | null;
  userId: string | null;
}): Promise<{ ok: true }> {
  const { workspaceId, entityId, relationId, counterpartyEntityId } = input;
  // Validate the entity belongs to the workspace.
  const ent = await prisma.entity.findFirst({ where: { id: entityId, group: { workspaceId } }, select: { id: true } });
  if (!ent) throw new Error("Administratie niet in deze werkruimte");

  if (!counterpartyEntityId) {
    await prisma.intercompanyRelation.deleteMany({ where: { entityId, relationId } });
    return { ok: true };
  }
  if (counterpartyEntityId === entityId) throw new Error("Een relatie kan niet naar de eigen administratie verwijzen");
  const cp = await prisma.entity.findFirst({ where: { id: counterpartyEntityId, group: { workspaceId } }, select: { id: true } });
  if (!cp) throw new Error("Tegenpartij-administratie niet in deze werkruimte");

  await prisma.intercompanyRelation.upsert({
    where: { entityId_relationId: { entityId, relationId } },
    create: {
      workspaceId,
      entityId,
      relationId,
      relationCode: input.relationCode,
      relationName: input.relationName,
      counterpartyEntityId,
      createdByUserId: input.userId,
    },
    update: { counterpartyEntityId, relationCode: input.relationCode, relationName: input.relationName },
  });
  return { ok: true };
}

/** entityId → (relationId → counterpartyEntityId) for the given entities. */
export async function getIntercompanyMap(entityIds: string[]): Promise<Map<string, Map<string, string>>> {
  const rows = await prisma.intercompanyRelation.findMany({
    where: { entityId: { in: entityIds } },
    select: { entityId: true, relationId: true, counterpartyEntityId: true },
  });
  const out = new Map<string, Map<string, string>>();
  for (const r of rows) {
    const inner = out.get(r.entityId) ?? new Map<string, string>();
    inner.set(r.relationId, r.counterpartyEntityId);
    out.set(r.entityId, inner);
  }
  return out;
}

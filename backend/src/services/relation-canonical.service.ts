import { prisma } from "../config/prisma.js";
import { tryGetConnectorForEntity } from "../clients/connectors/registry.js";
import { normName } from "./intercompany.service.js";

/**
 * Universal (canonical) relation layer. The same external debtor/creditor can
 * appear in several administrations under slightly different names; this groups
 * them into ONE canonical party so cross-administration views and dedup work.
 *
 * Two layers (mirrors the elimination-mapping design):
 *  - auto: relations group by normalized name (normName).
 *  - manual override: a RelationCanonicalOverride pins a relation to a chosen
 *    canonicalKey (merge differently-named relations / split a wrong merge) and
 *    can attach canonical attributes (display name, VAT, e-mail).
 */

export interface CanonicalMember {
  entityId: string;
  entityName: string;
  relationId: string;
  relationName: string;
  code: string | null;
  isDebtor: boolean;
  isCreditor: boolean;
  manual: boolean;
}
export interface CanonicalRelation {
  key: string;
  displayName: string;
  adminCount: number;
  memberCount: number;
  isDebtor: boolean;
  isCreditor: boolean;
  vatNumber: string | null;
  email: string | null;
  members: CanonicalMember[];
}
export interface CanonicalResult {
  entities: { id: string; name: string }[];
  relations: CanonicalRelation[];
  warnings: string[];
}

async function scopeEntities(workspaceId: string, groupId: string | null) {
  return prisma.entity.findMany({
    where: groupId ? { groupId, group: { workspaceId } } : { group: { workspaceId } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Group every administration's relations into canonical parties (auto + override). */
export async function listCanonicalRelations(workspaceId: string, groupId: string | null): Promise<CanonicalResult> {
  const entities = await scopeEntities(workspaceId, groupId);
  const warnings: string[] = [];
  const nameById = new Map(entities.map((e) => [e.id, e.name]));

  const overrides = await prisma.relationCanonicalOverride.findMany({
    where: { workspaceId, entityId: { in: entities.map((e) => e.id) } },
  });
  const ovByRel = new Map(overrides.map((o) => [`${o.entityId}|${o.relationId}`, o]));

  type Group = {
    key: string;
    displayNames: Map<string, number>;
    overrideDisplay: string | null;
    vatNumber: string | null;
    email: string | null;
    members: CanonicalMember[];
    admins: Set<string>;
  };
  const groups = new Map<string, Group>();

  for (const ent of entities) {
    const connector = await tryGetConnectorForEntity(ent.id);
    if (!connector) continue;
    let contacts: { id: string; name: string; code: string | null; isDebtor: boolean; isCreditor: boolean }[];
    try {
      const [debtors, creditors] = await Promise.all([connector.getDebtors(), connector.getCreditors()]);
      const merged = new Map<string, { id: string; name: string; code: string | null; isDebtor: boolean; isCreditor: boolean }>();
      for (const x of debtors) merged.set(x.id, { id: x.id, name: x.name, code: x.code, isDebtor: true, isCreditor: false });
      for (const x of creditors) {
        const e = merged.get(x.id) ?? { id: x.id, name: x.name, code: x.code, isDebtor: false, isCreditor: false };
        e.isCreditor = true;
        merged.set(x.id, e);
      }
      contacts = [...merged.values()];
    } catch (e) {
      warnings.push(`${ent.name}: relaties konden niet worden opgehaald (${e instanceof Error ? e.message : "fout"}).`);
      continue;
    }

    for (const c of contacts) {
      const ov = ovByRel.get(`${ent.id}|${c.id}`);
      const key = ov?.canonicalKey || normName(c.name) || c.name.toLowerCase();
      const g =
        groups.get(key) ??
        ({ key, displayNames: new Map(), overrideDisplay: null, vatNumber: null, email: null, members: [], admins: new Set() } as Group);
      g.members.push({
        entityId: ent.id,
        entityName: ent.name,
        relationId: c.id,
        relationName: c.name,
        code: c.code,
        isDebtor: c.isDebtor,
        isCreditor: c.isCreditor,
        manual: !!ov,
      });
      g.admins.add(ent.id);
      g.displayNames.set(c.name, (g.displayNames.get(c.name) ?? 0) + 1);
      if (ov?.displayName) g.overrideDisplay = ov.displayName;
      if (ov?.vatNumber) g.vatNumber = ov.vatNumber;
      if (ov?.email) g.email = ov.email;
      groups.set(key, g);
    }
  }

  const relations: CanonicalRelation[] = [...groups.values()].map((g) => {
    const topName = [...g.displayNames.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? g.key;
    return {
      key: g.key,
      displayName: g.overrideDisplay ?? topName,
      adminCount: g.admins.size,
      memberCount: g.members.length,
      isDebtor: g.members.some((m) => m.isDebtor),
      isCreditor: g.members.some((m) => m.isCreditor),
      vatNumber: g.vatNumber,
      email: g.email,
      members: g.members.sort((a, b) => a.entityName.localeCompare(b.entityName)),
    };
  });
  // Cross-administration parties first, then by name.
  relations.sort((a, b) => b.adminCount - a.adminCount || a.displayName.localeCompare(b.displayName));

  return { entities: entities.map((e) => ({ id: e.id, name: e.name })), relations, warnings };
}

/** Pin a relation to a canonical group (+ optional canonical attributes). */
export async function setRelationOverride(input: {
  workspaceId: string;
  entityId: string;
  relationId: string;
  relationName: string | null;
  canonicalKey: string;
  displayName?: string | null;
  vatNumber?: string | null;
  email?: string | null;
  userId: string | null;
}): Promise<{ ok: true }> {
  const { workspaceId, entityId } = input;
  const ent = await prisma.entity.findFirst({ where: { id: entityId, group: { workspaceId } }, select: { id: true } });
  if (!ent) throw new Error("Administratie niet in deze werkruimte");
  const canonicalKey = input.canonicalKey.trim();
  if (!canonicalKey) throw new Error("Canonieke sleutel ontbreekt");

  await prisma.relationCanonicalOverride.upsert({
    where: { entityId_relationId: { entityId, relationId: input.relationId } },
    create: {
      workspaceId,
      entityId,
      relationId: input.relationId,
      relationName: input.relationName,
      canonicalKey,
      displayName: input.displayName ?? null,
      vatNumber: input.vatNumber ?? null,
      email: input.email ?? null,
      createdByUserId: input.userId,
    },
    update: {
      canonicalKey,
      relationName: input.relationName,
      displayName: input.displayName ?? null,
      vatNumber: input.vatNumber ?? null,
      email: input.email ?? null,
    },
  });
  return { ok: true };
}

/** Set/replace the display name (+ optional VAT/e-mail) for a whole canonical
 *  group: applies an override to every member so the group keeps its identity. */
export async function renameCanonicalGroup(input: {
  workspaceId: string;
  groupId: string | null;
  canonicalKey: string;
  displayName: string;
  vatNumber?: string | null;
  email?: string | null;
  userId: string | null;
}): Promise<{ updated: number }> {
  const { workspaceId } = input;
  const current = await listCanonicalRelations(workspaceId, input.groupId ?? null);
  const grp = current.relations.find((r) => r.key === input.canonicalKey);
  if (!grp) throw new Error("Canonieke groep niet gevonden");
  let updated = 0;
  for (const m of grp.members) {
    await setRelationOverride({
      workspaceId,
      entityId: m.entityId,
      relationId: m.relationId,
      relationName: m.relationName,
      canonicalKey: input.canonicalKey,
      displayName: input.displayName,
      vatNumber: input.vatNumber ?? grp.vatNumber,
      email: input.email ?? grp.email,
      userId: input.userId,
    });
    updated += 1;
  }
  return { updated };
}

/** Detach a relation back to automatic (name-based) grouping. */
export async function clearRelationOverride(workspaceId: string, entityId: string, relationId: string): Promise<boolean> {
  const r = await prisma.relationCanonicalOverride.deleteMany({ where: { workspaceId, entityId, relationId } });
  return r.count > 0;
}

import { prisma } from "../config/prisma.js";
import { Prisma, ScopeLevel, ScopedRole } from "@prisma/client";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../utils/errors.js";

/**
 * Workspace-scoped team / role management. Lets a WORKSPACE/ACCOUNTANT/CLIENT
 * admin manage who has which scoped role inside THEIR workspace — without the
 * platform-admin surface. Every operation is hard-bounded to the caller's
 * workspace: scopes outside it are rejected, and platform roles are never
 * touched here.
 */

/** Memberships that live anywhere inside a workspace (ws / its groups / its entities). */
const inWorkspace = (workspaceId: string): Prisma.MembershipWhereInput => ({
  OR: [{ workspaceId }, { group: { workspaceId } }, { entity: { group: { workspaceId } } }],
});

export interface TeamMembership {
  id: string;
  scopeLevel: ScopeLevel;
  role: ScopedRole;
  scopeId: string;
  scopeName: string;
}
export interface TeamMember {
  userId: string;
  email: string;
  name: string;
  memberships: TeamMembership[];
}
export interface AssignableScope {
  level: ScopeLevel;
  id: string;
  name: string;
  /** For groups/entities: the parent path for display (e.g. "Groep › Adm."). */
  parentName?: string;
}
export interface TeamResult {
  members: TeamMember[];
  /** Scopes inside this workspace a role can be granted at. */
  scopes: AssignableScope[];
  roles: ScopedRole[];
}

/** List every member with a role inside the workspace + the assignable scopes. */
export async function listWorkspaceTeam(workspaceId: string): Promise<TeamResult> {
  const memberships = await prisma.membership.findMany({
    where: inWorkspace(workspaceId),
    include: {
      user: { select: { id: true, email: true, firstName: true, lastName: true } },
      workspace: { select: { id: true, name: true } },
      group: { select: { id: true, name: true } },
      entity: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  const byUser = new Map<string, TeamMember>();
  for (const m of memberships) {
    const u = m.user;
    const member =
      byUser.get(u.id) ??
      ({ userId: u.id, email: u.email, name: `${u.firstName} ${u.lastName}`.trim(), memberships: [] } as TeamMember);
    const scopeId = m.workspaceId ?? m.groupId ?? m.entityId ?? "";
    const scopeName = m.workspace?.name ?? m.group?.name ?? m.entity?.name ?? "(onbekend)";
    member.memberships.push({ id: m.id, scopeLevel: m.scopeLevel, role: m.role, scopeId, scopeName });
    byUser.set(u.id, member);
  }

  // Assignable scopes: the workspace + its groups + its entities.
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true, groups: { select: { id: true, name: true, entities: { select: { id: true, name: true } } } } },
  });
  if (!ws) throw new NotFoundError("Werkruimte niet gevonden");
  const scopes: AssignableScope[] = [{ level: ScopeLevel.WORKSPACE, id: ws.id, name: ws.name }];
  for (const g of ws.groups) {
    scopes.push({ level: ScopeLevel.GROUP, id: g.id, name: g.name });
    for (const e of g.entities) scopes.push({ level: ScopeLevel.ENTITY, id: e.id, name: e.name, parentName: g.name });
  }

  return {
    members: [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name)),
    scopes,
    roles: Object.values(ScopedRole),
  };
}

/** Verify a (level, id) scope belongs to the workspace; returns the FK to set. */
async function assertScopeInWorkspace(
  workspaceId: string,
  level: ScopeLevel,
  scopeId: string,
): Promise<Pick<Prisma.MembershipUncheckedCreateInput, "workspaceId" | "groupId" | "entityId">> {
  if (level === ScopeLevel.WORKSPACE) {
    if (scopeId !== workspaceId) throw new ForbiddenError("Alleen je eigen werkruimte");
    return { workspaceId };
  }
  if (level === ScopeLevel.GROUP) {
    const g = await prisma.group.findFirst({ where: { id: scopeId, workspaceId }, select: { id: true } });
    if (!g) throw new ForbiddenError("Groep niet in deze werkruimte");
    return { groupId: scopeId };
  }
  const e = await prisma.entity.findFirst({ where: { id: scopeId, group: { workspaceId } }, select: { id: true } });
  if (!e) throw new ForbiddenError("Administratie niet in deze werkruimte");
  return { entityId: scopeId };
}

/** Grant an EXISTING user a role at a scope inside the workspace. */
export async function addWorkspaceMember(input: {
  workspaceId: string;
  email: string;
  scopeLevel: ScopeLevel;
  scopeId: string;
  role: ScopedRole;
}): Promise<{ membershipId: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email) throw new BadRequestError("E-mailadres is verplicht");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) {
    throw new NotFoundError(
      "Geen gebruiker met dit e-mailadres gevonden. Laat de gebruiker eerst registreren of vraag de platformbeheerder de gebruiker aan te maken.",
    );
  }
  const fk = await assertScopeInWorkspace(input.workspaceId, input.scopeLevel, input.scopeId);
  try {
    const created = await prisma.membership.create({
      data: { userId: user.id, scopeLevel: input.scopeLevel, role: input.role, ...fk },
    });
    return { membershipId: created.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ConflictError("Deze gebruiker heeft al een rol op dit niveau");
    }
    throw e;
  }
}

/** Load a membership and assert it lives inside the workspace. */
async function membershipInWorkspace(membershipId: string, workspaceId: string) {
  const m = await prisma.membership.findUnique({
    where: { id: membershipId },
    include: { group: { select: { workspaceId: true } }, entity: { select: { group: { select: { workspaceId: true } } } } },
  });
  if (!m) throw new NotFoundError("Lidmaatschap niet gevonden");
  const wsId = m.workspaceId ?? m.group?.workspaceId ?? m.entity?.group?.workspaceId ?? null;
  if (wsId !== workspaceId) throw new ForbiddenError("Dit lidmaatschap valt buiten je werkruimte");
  return m;
}

/** Change a member's role (within the workspace). */
export async function updateWorkspaceMembership(
  membershipId: string,
  workspaceId: string,
  role: ScopedRole,
): Promise<{ id: string; role: ScopedRole }> {
  await membershipInWorkspace(membershipId, workspaceId);
  const m = await prisma.membership.update({ where: { id: membershipId }, data: { role } });
  return { id: m.id, role: m.role };
}

/** Revoke a membership (within the workspace). */
export async function removeWorkspaceMembership(membershipId: string, workspaceId: string): Promise<void> {
  await membershipInWorkspace(membershipId, workspaceId);
  await prisma.membership.delete({ where: { id: membershipId } });
}

import { prisma } from "../config/prisma.js";

/**
 * FIN//HUB Labs (#29): product feedback, feature voting & roadmap. Users post
 * ideas, upvote (one vote each) and comment; ideas move through a roadmap status
 * lifecycle. A lightweight token-overlap similarity check suggests existing
 * ideas at creation time to steer votes to a duplicate instead of a new entry.
 */

export const LAB_STATUSES = ["NEW", "UNDER_REVIEW", "PLANNED", "IN_PROGRESS", "BETA", "RELEASED", "DECLINED", "DUPLICATE"] as const;
export type LabStatus = (typeof LAB_STATUSES)[number];
export const LAB_CATEGORIES = [
  "CONNECTORS", "CONSOLIDATION", "REPORTING", "RGS_MAPPING", "NOTIFICATIONS",
  "API", "EXPORTS", "AI", "PERFORMANCE", "UX", "SECURITY", "INTEGRATIONS", "OTHER",
] as const;
export type LabCategory = (typeof LAB_CATEGORIES)[number];

const tokens = (s: string): Set<string> =>
  new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4));

function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.min(ta.size, tb.size);
}

export interface IdeaListItem {
  id: string;
  title: string;
  category: string;
  status: string;
  voteCount: number;
  commentCount: number;
  hasVoted: boolean;
  createdAt: string;
}

export async function listIdeas(input: {
  userId: string | null;
  status?: string;
  category?: string;
  sort?: "top" | "new";
}): Promise<{ ideas: IdeaListItem[]; counts: Record<string, number> }> {
  const where: { status?: string; category?: string; visibility?: string } = { visibility: "PUBLIC" };
  if (input.status) where.status = input.status;
  if (input.category) where.category = input.category;
  const rows = await prisma.labIdea.findMany({
    where,
    orderBy: input.sort === "new" ? { createdAt: "desc" } : [{ voteCount: "desc" }, { createdAt: "desc" }],
    take: 300,
    include: { _count: { select: { comments: true } }, votes: input.userId ? { where: { userId: input.userId }, select: { id: true } } : false },
  });
  const counts: Record<string, number> = {};
  for (const g of await prisma.labIdea.groupBy({ by: ["status"], where: { visibility: "PUBLIC" }, _count: true })) counts[g.status] = g._count;
  return {
    ideas: rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      status: r.status,
      voteCount: r.voteCount,
      commentCount: r._count.comments,
      hasVoted: Array.isArray(r.votes) ? r.votes.length > 0 : false,
      createdAt: r.createdAt.toISOString(),
    })),
    counts,
  };
}

/** Existing ideas similar to a proposed title (steer votes to duplicates). */
export async function suggestSimilar(title: string): Promise<{ id: string; title: string; voteCount: number; status: string }[]> {
  if (title.trim().length < 4) return [];
  const recent = await prisma.labIdea.findMany({
    where: { visibility: "PUBLIC", status: { notIn: ["DECLINED", "DUPLICATE"] } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { id: true, title: true, voteCount: true, status: true },
  });
  return recent
    .map((r) => ({ ...r, score: similarity(title, r.title) }))
    .filter((r) => r.score >= 0.34)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ id, title, voteCount, status }) => ({ id, title, voteCount, status }));
}

export async function createIdea(input: {
  title: string;
  description: string;
  category: string;
  workspaceId: string | null;
  userId: string | null;
}): Promise<{ id: string }> {
  const created = await prisma.labIdea.create({
    data: {
      title: input.title.trim().slice(0, 160),
      description: input.description.trim().slice(0, 4000),
      category: (LAB_CATEGORIES as readonly string[]).includes(input.category) ? input.category : "OTHER",
      workspaceId: input.workspaceId,
      createdByUserId: input.userId,
      // The author implicitly votes for their own idea.
      voteCount: 1,
      votes: input.userId ? { create: { userId: input.userId } } : undefined,
    },
  });
  return { id: created.id };
}

/** Toggle a user's vote; keeps the denormalized voteCount in sync. */
export async function toggleVote(ideaId: string, userId: string): Promise<{ voted: boolean; voteCount: number }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.labVote.findUnique({ where: { ideaId_userId: { ideaId, userId } } });
    if (existing) {
      await tx.labVote.delete({ where: { id: existing.id } });
      const idea = await tx.labIdea.update({ where: { id: ideaId }, data: { voteCount: { decrement: 1 } } });
      return { voted: false, voteCount: idea.voteCount };
    }
    await tx.labVote.create({ data: { ideaId, userId } });
    const idea = await tx.labIdea.update({ where: { id: ideaId }, data: { voteCount: { increment: 1 } } });
    return { voted: true, voteCount: idea.voteCount };
  });
}

export async function getIdea(id: string, userId: string | null) {
  const idea = await prisma.labIdea.findUnique({
    where: { id },
    include: {
      comments: { orderBy: { createdAt: "asc" }, take: 200 },
      votes: userId ? { where: { userId }, select: { id: true } } : false,
    },
  });
  if (!idea) return null;
  return {
    id: idea.id,
    title: idea.title,
    description: idea.description,
    category: idea.category,
    status: idea.status,
    voteCount: idea.voteCount,
    hasVoted: Array.isArray(idea.votes) ? idea.votes.length > 0 : false,
    createdAt: idea.createdAt.toISOString(),
    comments: idea.comments.map((c) => ({ id: c.id, userId: c.userId, body: c.body, createdAt: c.createdAt.toISOString() })),
  };
}

export async function addComment(ideaId: string, userId: string | null, body: string): Promise<{ id: string } | null> {
  const idea = await prisma.labIdea.findUnique({ where: { id: ideaId }, select: { id: true } });
  if (!idea) return null;
  const c = await prisma.labComment.create({ data: { ideaId, userId, body: body.trim().slice(0, 2000) } });
  return { id: c.id };
}

export async function setIdeaStatus(id: string, status: LabStatus): Promise<boolean> {
  const r = await prisma.labIdea.updateMany({ where: { id }, data: { status } });
  return r.count > 0;
}

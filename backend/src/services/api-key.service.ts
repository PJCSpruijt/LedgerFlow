import { createHash, randomBytes } from "node:crypto";
import type { ApiKey } from "@prisma/client";
import { prisma } from "../config/prisma.js";

/**
 * API keys for the external FIN//HUB Output API (#30). Keys are read-only and
 * workspace-scoped. Only a SHA-256 hash is stored; the raw key is returned once
 * at creation. A simple in-memory per-key rate limiter caps requests per minute.
 */

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** Generate a new key: returns the raw value (shown once) + the persisted row. */
export async function createApiKey(input: {
  workspaceId: string;
  name: string;
  entityId?: string | null;
  rateLimitPerMin?: number;
  expiresAt?: Date | null;
  createdByUserId?: string | null;
}): Promise<{ raw: string; apiKey: ApiKey }> {
  const raw = `fhk_${randomBytes(24).toString("hex")}`;
  const apiKey = await prisma.apiKey.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      prefix: raw.slice(0, 12),
      keyHash: hash(raw),
      entityId: input.entityId ?? null,
      rateLimitPerMin: input.rateLimitPerMin ?? 120,
      expiresAt: input.expiresAt ?? null,
      createdByUserId: input.createdByUserId ?? null,
    },
  });
  return { raw, apiKey };
}

/** Resolve a raw key to its (active) record, or null when invalid/revoked/expired. */
export async function verifyApiKey(raw: string): Promise<ApiKey | null> {
  if (!raw.startsWith("fhk_")) return null;
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hash(raw) } });
  if (!key || key.revokedAt) return null;
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return null;
  // Best-effort last-used stamp (throttled to once per minute per key).
  void touchLastUsed(key);
  return key;
}

const lastTouch = new Map<string, number>();
async function touchLastUsed(key: ApiKey): Promise<void> {
  const now = Date.now();
  if ((lastTouch.get(key.id) ?? 0) > now - 60_000) return;
  lastTouch.set(key.id, now);
  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
}

/** Masked listing for a workspace (never returns the hash). */
export async function listApiKeys(workspaceId: string) {
  const keys = await prisma.apiKey.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
  });
  return keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    entityId: k.entityId,
    rateLimitPerMin: k.rateLimitPerMin,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    revokedAt: k.revokedAt,
    createdAt: k.createdAt,
  }));
}

export async function revokeApiKey(workspaceId: string, id: string): Promise<boolean> {
  const r = await prisma.apiKey.updateMany({
    where: { id, workspaceId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return r.count > 0;
}

/* ---- In-memory rate limiter (per key, sliding 60s window) ---- */
const hits = new Map<string, number[]>();
export function checkRate(keyId: string, perMin: number): boolean {
  const now = Date.now();
  const arr = (hits.get(keyId) ?? []).filter((t) => t > now - 60_000);
  if (arr.length >= perMin) {
    hits.set(keyId, arr);
    return false;
  }
  arr.push(now);
  hits.set(keyId, arr);
  return true;
}

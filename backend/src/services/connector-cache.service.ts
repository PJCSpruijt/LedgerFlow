import { prisma } from "../config/prisma.js";
import { encryptJson, decryptJson } from "../utils/crypto.js";
import { getConnectorForEntity } from "../clients/connectors/registry.js";
import type { DateRange } from "../clients/connectors/interfaces/Connector.js";

/**
 * Day-cache for connector data. The raw connector result (trial balance,
 * transactions, debtors/creditors, outstanding) is stored AES-256-GCM encrypted
 * per administration + params with a fetchedAt timestamp. Reads within the TTL
 * skip the accounting API entirely; a force flag bypasses the cache and rewrites
 * it. Only the RAW source data is cached — RGS/VAT/FX transforms run per request
 * on the cached data, so mapping changes take effect without re-fetching.
 */

/** Default cache lifetime: one day. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Cached<T> {
  data: T;
  fetchedAt: Date;
  fromCache: boolean;
}

async function cachedFetch<T>(args: {
  entityId: string;
  method: string;
  paramsKey: string;
  force?: boolean;
  ttlMs?: number;
  fetcher: () => Promise<T>;
}): Promise<Cached<T>> {
  const { entityId, method, paramsKey, force, fetcher } = args;
  const ttl = args.ttlMs ?? CACHE_TTL_MS;

  if (!force) {
    // A cache problem must never break the actual data request — on any cache
    // read failure we silently fall through to a live fetch.
    try {
      const hit = await prisma.connectorCache.findUnique({
        where: { entityId_method_paramsKey: { entityId, method, paramsKey } },
      });
      if (hit && Date.now() - hit.fetchedAt.getTime() < ttl) {
        return { data: decryptJson<T>(hit.payload), fetchedAt: hit.fetchedAt, fromCache: true };
      }
    } catch {
      /* corrupt entry / cache table unavailable → fetch live */
    }
  }

  const data = await fetcher();
  const fetchedAt = new Date();
  const rowCount = Array.isArray(data) ? data.length : 0;
  // Best-effort write — never fail the request because the cache couldn't be written.
  await prisma.connectorCache
    .upsert({
      where: { entityId_method_paramsKey: { entityId, method, paramsKey } },
      create: { entityId, method, paramsKey, payload: encryptJson(data), rowCount, fetchedAt },
      update: { payload: encryptJson(data), rowCount, fetchedAt },
    })
    .catch(() => undefined);
  return { data, fetchedAt, fromCache: false };
}

// ---- Cached connector accessors -------------------------------------------

export function cachedTrialBalance(entityId: string, range: DateRange, force?: boolean) {
  return cachedFetch({
    entityId,
    method: "trialBalance",
    paramsKey: `${range.from}|${range.to}`,
    force,
    fetcher: async () => (await getConnectorForEntity(entityId)).getTrialBalance(range),
  });
}

export function cachedTransactions(entityId: string, range: DateRange, force?: boolean) {
  return cachedFetch({
    entityId,
    method: "transactions",
    paramsKey: `${range.from}|${range.to}`,
    force,
    fetcher: async () => (await getConnectorForEntity(entityId)).getTransactions(range),
  });
}

export function cachedDebtors(entityId: string, force?: boolean) {
  return cachedFetch({
    entityId,
    method: "debtors",
    paramsKey: "all",
    force,
    fetcher: async () => (await getConnectorForEntity(entityId)).getDebtors(),
  });
}

export function cachedCreditors(entityId: string, force?: boolean) {
  return cachedFetch({
    entityId,
    method: "creditors",
    paramsKey: "all",
    force,
    fetcher: async () => (await getConnectorForEntity(entityId)).getCreditors(),
  });
}

export function cachedOutstanding(entityId: string, kind: "debtor" | "creditor", force?: boolean) {
  return cachedFetch({
    entityId,
    method: "outstanding",
    paramsKey: kind,
    force,
    fetcher: async () => (await getConnectorForEntity(entityId)).getOutstanding(kind),
  });
}

// ---- Status & invalidation -------------------------------------------------

/** Most recent fetchedAt across a set of entities (for a "laatst opgehaald" label). */
export async function latestFetchedAt(entityIds: string[]): Promise<Date | null> {
  if (entityIds.length === 0) return null;
  const row = await prisma.connectorCache.findFirst({
    where: { entityId: { in: entityIds } },
    orderBy: { fetchedAt: "desc" },
    select: { fetchedAt: true },
  });
  return row?.fetchedAt ?? null;
}

/** Per-method cache status for one administration. */
export function getCacheStatus(entityId: string) {
  return prisma.connectorCache.findMany({
    where: { entityId },
    orderBy: { fetchedAt: "desc" },
    select: { method: true, paramsKey: true, rowCount: true, fetchedAt: true },
  });
}

/** Drop cache entries (force a full re-fetch on next read). */
export async function invalidateCache(entityIds: string[]): Promise<number> {
  const r = await prisma.connectorCache.deleteMany({ where: { entityId: { in: entityIds } } });
  return r.count;
}

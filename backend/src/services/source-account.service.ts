import { prisma } from "../config/prisma.js";
import { tryGetConnectorForEntity } from "../clients/connectors/registry.js";
import type { DateRange } from "../clients/connectors/interfaces/Connector.js";

/**
 * Source-account discovery — the raw "universal chart of accounts" layer.
 *
 * GL accounts are connector-native; we materialize the ones an entity actually
 * uses by reading its trial balance and upserting `SourceAccount` rows. This
 * gives the RGS mapping UI a concrete list to map, independent of any single
 * reporting period. Re-running refreshes name/type and bumps `lastSeenAt`.
 */

/** A reasonably wide default window so discovery captures the working chart. */
function defaultRange(): DateRange {
  const now = new Date();
  const from = `${now.getFullYear() - 2}-01-01`;
  const to = now.toISOString().slice(0, 10);
  return { from, to };
}

export async function syncSourceAccounts(
  entityId: string,
  range?: DateRange,
): Promise<{ discovered: number }> {
  const connector = await tryGetConnectorForEntity(entityId);
  if (!connector) return { discovered: 0 };

  const tb = await connector.getTrialBalance(range ?? defaultRange());
  const now = new Date();
  let discovered = 0;
  for (const line of tb) {
    const code = (line.glAccountCode ?? "").trim();
    if (!code) continue;
    await prisma.sourceAccount.upsert({
      where: { entityId_code: { entityId, code } },
      create: {
        entityId,
        code,
        name: line.glAccountName || code,
        accountType: line.accountType || "UNKNOWN",
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        name: line.glAccountName || code,
        accountType: line.accountType || "UNKNOWN",
        lastSeenAt: now,
      },
    });
    discovered += 1;
  }
  return { discovered };
}

export async function listSourceAccounts(entityId: string) {
  return prisma.sourceAccount.findMany({
    where: { entityId },
    orderBy: { code: "asc" },
  });
}

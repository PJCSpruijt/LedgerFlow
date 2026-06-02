import { prisma } from "../config/prisma.js";

/**
 * Per-connection API usage + limit visibility.
 *
 * Reads the append-only ApiUsageLog (#26) and rolls it up per administration /
 * connection so a workspace admin can see how heavily each koppeling is used and
 * whether it is near (or over) its daily limit.
 *
 * Honesty per connector kind:
 *  - e-Boekhouden returns x-ratelimit-limit / -remaining headers → we show the
 *    real "X van Y over" and warn when the remaining budget runs low.
 *  - Yuki (SOAP) exposes NO quota numbers; the daily limit only surfaces as a
 *    fault when exceeded. So we show today's call volume and flag "daglimiet
 *    bereikt" only once it actually happens — never an invented number.
 */

/** Warn when the remaining header budget drops to/below this fraction. */
const WARN_RATIO = 0.15;

export type ConnectionUsageStatus = "ok" | "warning" | "limited" | "unknown" | "no-connection";

export interface ConnectionUsage {
  entityId: string;
  entityName: string;
  groupName: string;
  connectorType: string | null;
  /** Calls since local midnight (the daily-limit window). */
  callsToday: number;
  /** Calls + failures over the lookback window (`days`). */
  callsWindow: number;
  failedWindow: number;
  /** A daily/rate limit was actually hit today. */
  rateLimitedToday: boolean;
  lastCallAt: string | null;
  /** Latest header snapshot (e-Boekhouden); null when the connector gives none. */
  rateLimitLimit: number | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  status: ConnectionUsageStatus;
  message: string;
}

export interface ConnectionUsageResult {
  days: number;
  generatedAt: string;
  connections: ConnectionUsage[];
}

const isLimitError = (statusCode: number | null, errorMessage: string | null): boolean =>
  statusCode === 429 || /limit|limiet|quota|too many|daglimiet/i.test(errorMessage ?? "");

/**
 * Roll up usage per visible connection in the scope. `visibleEntities` is the
 * caller-filtered set (membership-checked), so this never leaks other admins'
 * administrations.
 */
export async function getConnectionUsage(
  visibleEntities: { id: string; name: string; groupName: string; connectorType: string | null }[],
  days: number,
  now: Date,
): Promise<ConnectionUsageResult> {
  const entityIds = visibleEntities.map((e) => e.id);
  const since = new Date(now.getTime() - days * 86_400_000);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  // One scan over the window; aggregate in memory per entity.
  const logs = entityIds.length
    ? await prisma.apiUsageLog.findMany({
        where: { entityId: { in: entityIds }, startedAt: { gte: since } },
        select: {
          entityId: true,
          startedAt: true,
          success: true,
          statusCode: true,
          errorMessage: true,
          rateLimitLimit: true,
          rateLimitRemaining: true,
          rateLimitResetAt: true,
        },
        orderBy: { startedAt: "asc" },
      })
    : [];

  type Agg = {
    callsToday: number;
    callsWindow: number;
    failedWindow: number;
    rateLimitedToday: boolean;
    lastCallAt: Date | null;
    rlLimit: number | null;
    rlRemaining: number | null;
    rlResetAt: Date | null;
  };
  const byEntity = new Map<string, Agg>();
  for (const id of entityIds) {
    byEntity.set(id, { callsToday: 0, callsWindow: 0, failedWindow: 0, rateLimitedToday: false, lastCallAt: null, rlLimit: null, rlRemaining: null, rlResetAt: null });
  }
  for (const l of logs) {
    const a = l.entityId ? byEntity.get(l.entityId) : undefined;
    if (!a) continue;
    a.callsWindow += 1;
    if (!l.success) a.failedWindow += 1;
    const today = l.startedAt >= startOfToday;
    if (today) {
      a.callsToday += 1;
      if (!l.success && isLimitError(l.statusCode, l.errorMessage)) a.rateLimitedToday = true;
    }
    a.lastCallAt = l.startedAt; // logs are ascending → last wins
    // Latest non-null header snapshot (logs ascending → keep overwriting).
    if (l.rateLimitRemaining != null) {
      a.rlRemaining = l.rateLimitRemaining;
      a.rlLimit = l.rateLimitLimit;
      a.rlResetAt = l.rateLimitResetAt;
    }
  }

  const connections: ConnectionUsage[] = visibleEntities.map((e) => {
    const a = byEntity.get(e.id)!;
    let status: ConnectionUsageStatus;
    let message: string;
    if (!e.connectorType) {
      status = "no-connection";
      message = "Geen koppeling ingesteld.";
    } else if (a.rateLimitedToday) {
      status = "limited";
      message = "Daglimiet vandaag bereikt — gegevens kunnen tijdelijk onvolledig zijn.";
    } else if (a.rlRemaining != null && a.rlLimit && a.rlLimit > 0) {
      const ratio = a.rlRemaining / a.rlLimit;
      if (ratio <= WARN_RATIO) {
        status = "warning";
        message = `Nog ${a.rlRemaining} van ${a.rlLimit} verzoeken over — limiet komt in zicht.`;
      } else {
        status = "ok";
        message = `${a.rlRemaining} van ${a.rlLimit} verzoeken over.`;
      }
    } else if (e.connectorType === "YUKI") {
      status = "unknown";
      message = `${a.callsToday} verzoek(en) vandaag. Yuki geeft geen verbruikslimiet door; een daglimiet wordt pas bij overschrijding gemeld.`;
    } else {
      status = "ok";
      message = `${a.callsToday} verzoek(en) vandaag.`;
    }
    return {
      entityId: e.id,
      entityName: e.name,
      groupName: e.groupName,
      connectorType: e.connectorType,
      callsToday: a.callsToday,
      callsWindow: a.callsWindow,
      failedWindow: a.failedWindow,
      rateLimitedToday: a.rateLimitedToday,
      lastCallAt: a.lastCallAt ? a.lastCallAt.toISOString() : null,
      rateLimitLimit: a.rlLimit,
      rateLimitRemaining: a.rlRemaining,
      rateLimitResetAt: a.rlResetAt ? a.rlResetAt.toISOString() : null,
      status,
      message,
    };
  });

  return { days, generatedAt: now.toISOString(), connections };
}

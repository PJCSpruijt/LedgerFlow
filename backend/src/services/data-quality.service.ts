import { prisma } from "../config/prisma.js";
import { tryGetConnectorForEntity } from "../clients/connectors/registry.js";
import { applyRgsMappings } from "./rgs-mapping.service.js";
import { cachedTrialBalance } from "./connector-cache.service.js";
import { isRateLimitError } from "../utils/errors.js";

/**
 * Data-quality dashboard. Per administration in the scope it reports how clean
 * the normalized layer is: RGS mapping coverage (mapped vs total source
 * accounts), connector sync health (last sync / test), data freshness (cache
 * age) and a drill-down of the still-unmapped accounts. Rolls up to a workspace
 * summary so an admin sees at a glance where the gaps are.
 */

export type DqStatus = "ok" | "warning" | "error";

export interface EntityDataQuality {
  entityId: string;
  entityName: string;
  groupName: string;
  connected: boolean;
  connectorType: string | null;
  lastSyncAt: string | null;
  lastTestedAt: string | null;
  dataFetchedAt: string | null;
  staleDays: number | null;
  rgsEnabled: boolean;
  accounts: number;
  mapped: number;
  unmapped: number;
  coverage: number; // 0..1
  unmappedAccounts: { code: string; name: string }[];
  status: DqStatus;
  issues: string[];
}

export interface DataQualityResult {
  generatedAt: string;
  rgsEnabled: boolean;
  rows: EntityDataQuality[];
  totals: {
    administrations: number;
    connected: number;
    accounts: number;
    mapped: number;
    unmapped: number;
    coverage: number;
    stale: number;
    withUnmapped: number;
    notConnected: number;
  };
  loadStatus: { id: string; name: string; included: boolean; reason?: string; rateLimited?: boolean }[];
  warnings: string[];
}

export interface DataQualityInput {
  workspaceId: string;
  groupId?: string | null;
  /** Period used only to scope the trial-balance fetch (coverage is account-level). */
  from: string;
  to: string;
  refresh?: boolean;
}

const STALE_DAYS = 2;

export async function computeDataQuality(input: DataQualityInput): Promise<DataQualityResult> {
  const { workspaceId, from, to } = input;
  const groupId = input.groupId ?? null;
  const force = input.refresh ?? false;
  const warnings: string[] = [];
  const now = Date.now();

  const settings = await prisma.workspaceSettings.findUnique({ where: { workspaceId }, select: { rgsEnabled: true } });
  const rgsEnabled = settings?.rgsEnabled ?? false;

  const entities = await prisma.entity.findMany({
    where: groupId ? { groupId, group: { workspaceId } } : { group: { workspaceId } },
    select: {
      id: true,
      name: true,
      group: { select: { name: true } },
      connection: { select: { kind: true, lastSyncAt: true, lastTestedAt: true } },
    },
    orderBy: { name: "asc" },
  });

  const loadStatus: DataQualityResult["loadStatus"] = [];
  const rows: EntityDataQuality[] = [];

  await Promise.all(
    entities.map(async (ent) => {
      const connector = await tryGetConnectorForEntity(ent.id);
      const connected = !!connector;
      const base = {
        entityId: ent.id,
        entityName: ent.name,
        groupName: ent.group.name,
        connectorType: ent.connection?.kind ?? null,
        lastSyncAt: ent.connection?.lastSyncAt ? ent.connection.lastSyncAt.toISOString() : null,
        lastTestedAt: ent.connection?.lastTestedAt ? ent.connection.lastTestedAt.toISOString() : null,
        rgsEnabled,
      };

      if (!connected) {
        loadStatus.push({ id: ent.id, name: ent.name, included: false, reason: "Geen koppeling" });
        rows.push({
          ...base,
          connected: false,
          dataFetchedAt: null,
          staleDays: null,
          accounts: 0,
          mapped: 0,
          unmapped: 0,
          coverage: 0,
          unmappedAccounts: [],
          status: "error",
          issues: ["Geen koppeling ingesteld"],
        });
        return;
      }

      let lines, fetchedAt: Date;
      try {
        const tbRes = await cachedTrialBalance(ent.id, { from, to }, force);
        lines = await applyRgsMappings(tbRes.data, workspaceId, ent.id);
        fetchedAt = tbRes.fetchedAt;
      } catch (e) {
        loadStatus.push({ id: ent.id, name: ent.name, included: false, reason: e instanceof Error ? e.message : "Ophalen mislukt", rateLimited: isRateLimitError(e) });
        rows.push({
          ...base,
          connected: true,
          dataFetchedAt: null,
          staleDays: null,
          accounts: 0,
          mapped: 0,
          unmapped: 0,
          coverage: 0,
          unmappedAccounts: [],
          status: "error",
          issues: [isRateLimitError(e) ? "Daglimiet bereikt — tijdelijk geen data" : "Gegevens konden niet worden opgehaald"],
        });
        return;
      }
      loadStatus.push({ id: ent.id, name: ent.name, included: true });

      const accounts = lines.length;
      const mappedLines = lines.filter((l) => l.rgsCode);
      const mapped = mappedLines.length;
      const unmapped = accounts - mapped;
      const coverage = accounts > 0 ? mapped / accounts : 1;
      const unmappedAccounts = lines
        .filter((l) => !l.rgsCode)
        .slice(0, 25)
        .map((l) => ({ code: l.glAccountCode, name: l.glAccountName }));
      const staleDays = Math.floor((now - fetchedAt.getTime()) / 86_400_000);

      const issues: string[] = [];
      if (!rgsEnabled) issues.push("RGS-normalisatie staat uit voor deze werkruimte");
      else if (unmapped > 0) issues.push(`${unmapped} rekening(en) nog niet aan RGS gekoppeld`);
      if (staleDays >= STALE_DAYS) issues.push(`Gegevens ${staleDays} dagen oud`);

      let status: DqStatus = "ok";
      if (rgsEnabled && unmapped > 0) status = "warning";
      if (staleDays >= STALE_DAYS) status = status === "ok" ? "warning" : status;

      rows.push({
        ...base,
        connected: true,
        dataFetchedAt: fetchedAt.toISOString(),
        staleDays,
        accounts,
        mapped,
        unmapped,
        coverage,
        unmappedAccounts,
        status,
        issues,
      });
    }),
  );

  rows.sort((a, b) => a.entityName.localeCompare(b.entityName));

  const connectedRows = rows.filter((r) => r.connected && r.accounts > 0);
  const totAccounts = connectedRows.reduce((s, r) => s + r.accounts, 0);
  const totMapped = connectedRows.reduce((s, r) => s + r.mapped, 0);
  const totals = {
    administrations: rows.length,
    connected: rows.filter((r) => r.connected).length,
    accounts: totAccounts,
    mapped: totMapped,
    unmapped: totAccounts - totMapped,
    coverage: totAccounts > 0 ? totMapped / totAccounts : 1,
    stale: rows.filter((r) => r.staleDays != null && r.staleDays >= STALE_DAYS).length,
    withUnmapped: rows.filter((r) => r.unmapped > 0).length,
    notConnected: rows.filter((r) => !r.connected).length,
  };

  if (loadStatus.some((s) => s.rateLimited)) {
    warnings.push(`Daglimiet bereikt voor ${loadStatus.filter((s) => s.rateLimited).map((s) => s.name).join(", ")}; datakwaliteit tijdelijk onvolledig.`);
  }
  if (!rgsEnabled) warnings.push("RGS-normalisatie staat uit; mapping-dekking is niet van toepassing (Instellingen → RGS / normalisatie).");

  return {
    generatedAt: new Date().toISOString(),
    rgsEnabled,
    rows,
    totals,
    loadStatus,
    warnings,
  };
}

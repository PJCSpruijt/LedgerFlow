import { useState } from "react";

/**
 * Internal, platform-admin-only "Data Storage Policy" view.
 *
 * Shows, per workspace, the active data-storage posture derived from the
 * Data Storage & Security Architecture: active storage mode, whether caching is
 * enabled, retention settings, last purge job, connector-credential status, and
 * API-usage / audit retention.
 *
 * This is intentionally a read-only operational summary. The values below are
 * placeholders wired to a typed shape; replace `MOCK` with a real
 * `GET /api/platform/data-storage-policy` response (react-query) when the
 * backend endpoint lands. Kept in the application platform — never in the
 * marketing site.
 */

type StorageMode = "ZERO_STORAGE" | "TEMPORARY_CACHE" | "ENTERPRISE_WAREHOUSE";

interface CredentialStatus {
  connector: string;
  environment: string;
  encryption: "FIELD_LEVEL" | "NONE";
  tokenStorage: "HASHED" | "ENCRYPTED";
  status: "OK" | "EXPIRING" | "ERROR";
}

interface DataStoragePolicy {
  workspaceName: string;
  storageMode: StorageMode;
  cachingEnabled: boolean;
  cacheRetention: string | null;
  lastPurgeJobAt: string | null;
  lastPurgeJobStatus: "SUCCESS" | "FAILED" | "NEVER";
  apiUsageRetentionDays: number;
  auditRetentionDays: number;
  credentials: CredentialStatus[];
}

const MODE_LABELS: Record<StorageMode, { label: string; tone: string; note: string }> = {
  ZERO_STORAGE: {
    label: "Zero-storage (standaard)",
    tone: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    note: "Alleen configuratie, mappings, referentiedata en audit-/gebruiksmetadata worden bewaard.",
  },
  TEMPORARY_CACHE: {
    label: "Tijdelijke cache",
    tone: "bg-amber-50 text-amber-700 ring-amber-200",
    note: "Kortlevende versleutelde cache actief; transactiedata wordt tijdelijk bewaard volgens retentiebeleid.",
  },
  ENTERPRISE_WAREHOUSE: {
    label: "Enterprise warehouse",
    tone: "bg-violet-50 text-violet-700 ring-violet-200",
    note: "Langdurige afgeleide financiële opslag actief voor rapportagehistorie/analytics.",
  },
};

// Placeholder data — swap for a real platform endpoint when available.
const MOCK: DataStoragePolicy = {
  workspaceName: "Huidige werkruimte",
  storageMode: "ZERO_STORAGE",
  cachingEnabled: false,
  cacheRetention: null,
  lastPurgeJobAt: null,
  lastPurgeJobStatus: "NEVER",
  apiUsageRetentionDays: 365,
  auditRetentionDays: 730,
  credentials: [
    { connector: "Yuki", environment: "Productie", encryption: "FIELD_LEVEL", tokenStorage: "ENCRYPTED", status: "OK" },
    { connector: "e-Boekhouden", environment: "Productie", encryption: "FIELD_LEVEL", tokenStorage: "HASHED", status: "OK" },
  ],
};

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-0">
      <div>
        <div className="text-sm font-medium text-slate-700">{label}</div>
        {hint && <div className="text-xs text-slate-400">{hint}</div>}
      </div>
      <div className="text-right text-sm text-slate-900">{value}</div>
    </div>
  );
}

export function DataStoragePolicyPage() {
  // When the backend is ready, replace this with react-query against the platform API.
  const [policy] = useState<DataStoragePolicy>(MOCK);
  const mode = MODE_LABELS[policy.storageMode];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Databeleid &amp; opslag</h1>
        <p className="text-sm text-slate-500">
          Interne weergave van de actieve opslagstand per werkruimte, conform de Data Storage &amp; Security
          Architecture. Standaard draait FIN//HUB in zero-storage: transactiedata wordt on-demand opgehaald en
          niet als tweede grootboek bewaard.
        </p>
      </div>

      {/* Active mode banner */}
      <div className={`rounded-xl p-4 ring-1 ${mode.tone}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Actieve opslagmodus: {mode.label}</span>
          <span className="rounded-full bg-white/60 px-2.5 py-0.5 text-xs font-medium">
            {policy.workspaceName}
          </span>
        </div>
        <p className="mt-1 text-xs opacity-90">{mode.note}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Storage & retention */}
        <div className="lf-card">
          <h2 className="text-sm font-semibold text-slate-900">Opslag &amp; bewaring</h2>
          <div className="mt-2">
            <Row
              label="Caching ingeschakeld"
              value={
                <span
                  className={`lf-pill ${policy.cachingEnabled ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600"}`}
                >
                  {policy.cachingEnabled ? "Aan" : "Uit"}
                </span>
              }
            />
            <Row label="Cache-retentie" value={policy.cacheRetention ?? "—"} hint="Bij tijdelijke-cache-modus" />
            <Row
              label="API-gebruik retentie"
              value={`${policy.apiUsageRetentionDays} dagen`}
              hint="Append-only gebruiksmetadata"
            />
            <Row label="Audit retentie" value={`${policy.auditRetentionDays} dagen`} hint="Onveranderbare auditlog" />
          </div>
        </div>

        {/* Purge job */}
        <div className="lf-card">
          <h2 className="text-sm font-semibold text-slate-900">Laatste opschoontaak</h2>
          <div className="mt-2">
            <Row
              label="Status"
              value={
                <span
                  className={`lf-pill ${
                    policy.lastPurgeJobStatus === "SUCCESS"
                      ? "bg-emerald-100 text-emerald-700"
                      : policy.lastPurgeJobStatus === "FAILED"
                        ? "bg-red-100 text-red-700"
                        : "bg-slate-100 text-slate-600"
                  }`}
                >
                  {policy.lastPurgeJobStatus === "SUCCESS"
                    ? "Geslaagd"
                    : policy.lastPurgeJobStatus === "FAILED"
                      ? "Mislukt"
                      : "Nooit uitgevoerd"}
                </span>
              }
            />
            <Row label="Tijdstip" value={policy.lastPurgeJobAt ?? "—"} />
            <Row
              label="Toelichting"
              value={
                policy.storageMode === "ZERO_STORAGE"
                  ? "Geen transactiedata om op te schonen"
                  : "Volgens retentiebeleid"
              }
            />
          </div>
        </div>
      </div>

      {/* Connector credential status */}
      <div className="lf-card">
        <h2 className="text-sm font-semibold text-slate-900">Connector-credentials</h2>
        <p className="text-xs text-slate-400">
          Inloggegevens worden op veldniveau versleuteld; tokens gehasht of versleuteld waar replay nodig is.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                <th className="py-2 pr-4 font-medium">Connector</th>
                <th className="py-2 pr-4 font-medium">Omgeving</th>
                <th className="py-2 pr-4 font-medium">Encryptie</th>
                <th className="py-2 pr-4 font-medium">Token-opslag</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {policy.credentials.map((c) => (
                <tr key={c.connector} className="border-b border-slate-100 last:border-0">
                  <td className="py-2.5 pr-4 font-medium text-slate-700">{c.connector}</td>
                  <td className="py-2.5 pr-4 text-slate-600">{c.environment}</td>
                  <td className="py-2.5 pr-4 text-slate-600">
                    {c.encryption === "FIELD_LEVEL" ? "Veldniveau" : "Geen"}
                  </td>
                  <td className="py-2.5 pr-4 text-slate-600">
                    {c.tokenStorage === "HASHED" ? "Gehasht" : "Versleuteld"}
                  </td>
                  <td className="py-2.5">
                    <span
                      className={`lf-pill ${
                        c.status === "OK"
                          ? "bg-emerald-100 text-emerald-700"
                          : c.status === "EXPIRING"
                            ? "bg-amber-100 text-amber-700"
                            : "bg-red-100 text-red-700"
                      }`}
                    >
                      {c.status === "OK" ? "Actief" : c.status === "EXPIRING" ? "Verloopt binnenkort" : "Fout"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-400">
        Let op: dit is een interne, alleen-lezen samenvatting. Waarden zijn nu placeholders; koppel aan een
        platform-endpoint (bijv. <code>GET /api/platform/data-storage-policy</code>) zodra beschikbaar.
      </p>
    </div>
  );
}

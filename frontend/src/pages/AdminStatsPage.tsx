import { useEffect, useState } from "react";
import { api, ApiError } from "../services/api";

interface Totals {
  users: number;
  workspaces: number;
  entities: number;
  activeSubscriptions: number;
  events: number;
  exports: number;
}
interface WorkspaceStat {
  id: string;
  name: string;
  memberCount: number;
  entityCount: number;
  planName: string | null;
  subscriptionStatus: string;
  events: number;
  exports: number;
  lastActivity: string | null;
}
interface UserStat {
  id: string;
  name: string;
  email: string;
  platformRole: "PLATFORM_ADMIN" | "USER";
  loginCount: number;
  lastLoginAt: string | null;
  actions: number;
  exports: number;
}
interface StatsResponse {
  days: number;
  totals: Totals;
  perWorkspace: WorkspaceStat[];
  perUser: UserStat[];
}

const PERIODS = [
  { days: 7, label: "7 dagen" },
  { days: 30, label: "30 dagen" },
  { days: 90, label: "90 dagen" },
  { days: 0, label: "Alles" },
];

const fmtDateTime = (s: string | null) => (s ? new Date(s).toLocaleString("nl-NL") : "—");

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="lf-card">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}

interface UsageSummary {
  days: number;
  totals: {
    calls: number;
    failed: number;
    success: number;
    retries: number;
    documentDownloads: number;
    avgDurationMs: number;
    bytesReceived: number;
    bytesSent: number;
  };
  byChannel: { initiatorType: string; direction: string; calls: number; failed: number }[];
  byConnector: { connectorType: string; calls: number; avgDurationMs: number }[];
  byOperation: { operationType: string; calls: number }[];
  byWorkspace: { workspaceId: string | null; workspaceName: string; calls: number }[];
  topErrors: { operationType: string; connectorType: string; statusCode: number | null; count: number }[];
}

const OP_LABELS: Record<string, string> = {
  auth: "Authenticatie",
  token_refresh: "Token verversen",
  session_close: "Sessie sluiten",
  trial_balance_sync: "Proefbalans",
  transactions_sync: "Transacties",
  outstanding_sync: "Openstaande posten",
  relations_sync: "Relaties",
  document_retrieval: "Document / PDF",
  coa_sync: "Rekeningschema",
  administration_discovery: "Administratie-discovery",
  other: "Overig",
};
const opLabel = (k: string) => OP_LABELS[k] ?? k;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function ConnectorUsageSection({ days }: { days: number }) {
  const [u, setU] = useState<UsageSummary | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const usageDays = days === 0 ? 365 : days;
    void api<UsageSummary>(`/api/admin/usage?days=${usageDays}`)
      .then(setU)
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Kon gebruik niet laden"));
  }, [days]);

  if (err) return <div className="text-sm text-red-600">{err}</div>;
  if (!u) return <div className="lf-card">Connector-gebruik laden…</div>;

  const channel = (t: string) =>
    u.byChannel.filter((c) => c.initiatorType === t).reduce((s, c) => s + c.calls, 0);
  const userCalls = channel("USER");
  const apiCalls = channel("API");
  const systemCalls = channel("SYSTEM");
  const successRate = u.totals.calls ? Math.round((u.totals.success / u.totals.calls) * 100) : 100;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Connector- & API-gebruik</h2>
        <p className="text-sm text-slate-500">
          Uitgaande calls naar de boekhoudpakketten en (straks) inkomende API-calls van externe
          software. SECURITY: nooit tokens/credentials — alleen metadata + hashes.
        </p>
      </div>

      {/* Channel split */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="lf-card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Gebruikersverkeer</div>
          <div className="mt-1 text-2xl font-bold">{userCalls}</div>
          <div className="text-xs text-slate-500 mt-1">Gebruiker → boekhoudpakket (UI)</div>
        </div>
        <div className="lf-card">
          <div className="text-xs uppercase tracking-wide text-slate-500">API-verkeer</div>
          <div className="mt-1 text-2xl font-bold">{apiCalls}</div>
          <div className="text-xs text-slate-500 mt-1">Externe software → FIN//HUB (PowerBI, CaseWare…)</div>
        </div>
        <div className="lf-card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Systeem / achtergrond</div>
          <div className="mt-1 text-2xl font-bold">{systemCalls}</div>
          <div className="text-xs text-slate-500 mt-1">Cron / geplande syncs</div>
        </div>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard label="Calls totaal" value={u.totals.calls} />
        <StatCard label="Mislukt" value={u.totals.failed} />
        <StatCard label="Succes" value={`${successRate}%`} />
        <StatCard label="Retries" value={u.totals.retries} />
        <StatCard label="Gem. duur" value={`${u.totals.avgDurationMs} ms`} />
        <StatCard label="Datavolume" value={fmtBytes(u.totals.bytesReceived + u.totals.bytesSent)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="lf-card">
          <h3 className="font-semibold mb-2">Per koppeling</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1.5 pr-4 font-medium">Koppeling</th>
                <th className="py-1.5 pr-4 font-medium text-right">Calls</th>
                <th className="py-1.5 pr-4 font-medium text-right">Gem. duur</th>
              </tr>
            </thead>
            <tbody>
              {u.byConnector.map((c) => (
                <tr key={c.connectorType} className="border-b border-slate-100">
                  <td className="py-1.5 pr-4">{c.connectorType}</td>
                  <td className="py-1.5 pr-4 text-right">{c.calls}</td>
                  <td className="py-1.5 pr-4 text-right text-slate-500">{c.avgDurationMs} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="lf-card">
          <h3 className="font-semibold mb-2">Per operatie</h3>
          <table className="w-full text-sm">
            <tbody>
              {u.byOperation.map((o) => (
                <tr key={o.operationType} className="border-b border-slate-100">
                  <td className="py-1.5 pr-4">{opLabel(o.operationType)}</td>
                  <td className="py-1.5 pr-4 text-right">{o.calls}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="lf-card">
          <h3 className="font-semibold mb-2">Per werkruimte</h3>
          <table className="w-full text-sm">
            <tbody>
              {u.byWorkspace.map((w) => (
                <tr key={w.workspaceId ?? "none"} className="border-b border-slate-100">
                  <td className="py-1.5 pr-4">{w.workspaceName}</td>
                  <td className="py-1.5 pr-4 text-right">{w.calls}</td>
                </tr>
              ))}
              {u.byWorkspace.length === 0 && (
                <tr>
                  <td className="py-2 text-slate-400">Nog geen verkeer.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="lf-card">
          <h3 className="font-semibold mb-2">Mislukte calls (top)</h3>
          <table className="w-full text-sm">
            <tbody>
              {u.topErrors.map((e, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1.5 pr-4">
                    {opLabel(e.operationType)}{" "}
                    <span className="text-xs text-slate-400">{e.connectorType}</span>
                  </td>
                  <td className="py-1.5 pr-4 text-right text-red-600">{e.statusCode ?? "—"}</td>
                  <td className="py-1.5 pr-4 text-right">{e.count}</td>
                </tr>
              ))}
              {u.topErrors.length === 0 && (
                <tr>
                  <td className="py-2 text-emerald-700">Geen mislukte calls 🎉</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function AdminStatsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<StatsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void (async () => {
      try {
        const r = await api<StatsResponse>(`/api/admin/stats?days=${days}`);
        setData(r);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Kon statistieken niet laden");
      } finally {
        setLoading(false);
      }
    })();
  }, [days]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Statistieken</h1>
          <p className="text-sm text-slate-500 mt-1">
            Activiteit per werkruimte en gebruiker. "Verbruik" = export-/sync-acties.
          </p>
        </div>
        <div className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.days}
              className={`px-3 py-1.5 text-sm rounded-md ${
                days === p.days
                  ? "bg-brand-600 text-white"
                  : "bg-white ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50"
              }`}
              onClick={() => setDays(p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}
      {loading && !data ? (
        <div className="lf-card">Statistieken laden…</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <StatCard label="Gebruikers" value={data.totals.users} />
            <StatCard label="Werkruimtes" value={data.totals.workspaces} />
            <StatCard label="Administraties" value={data.totals.entities} />
            <StatCard label="Actieve abonnementen" value={data.totals.activeSubscriptions} />
            <StatCard label="Acties (periode)" value={data.totals.events} />
            <StatCard label="Exports (periode)" value={data.totals.exports} />
          </div>

          <ConnectorUsageSection days={days} />

          <div className="lf-card">
            <h2 className="text-lg font-semibold mb-3">Per werkruimte</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-4 font-medium">Werkruimte</th>
                    <th className="py-2 pr-4 font-medium">Plan</th>
                    <th className="py-2 pr-4 font-medium">Leden</th>
                    <th className="py-2 pr-4 font-medium">Administraties</th>
                    <th className="py-2 pr-4 font-medium">Acties</th>
                    <th className="py-2 pr-4 font-medium">Exports</th>
                    <th className="py-2 pr-4 font-medium">Laatste activiteit</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perWorkspace.map((w) => (
                    <tr key={w.id} className="border-b border-slate-100">
                      <td className="py-2 pr-4 font-medium">{w.name}</td>
                      <td className="py-2 pr-4 text-slate-600">
                        {w.planName ?? "—"} · {w.subscriptionStatus}
                      </td>
                      <td className="py-2 pr-4 text-slate-600">{w.memberCount}</td>
                      <td className="py-2 pr-4 text-slate-600">{w.entityCount}</td>
                      <td className="py-2 pr-4 text-slate-600">{w.events}</td>
                      <td className="py-2 pr-4 text-slate-600">{w.exports}</td>
                      <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">
                        {fmtDateTime(w.lastActivity)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="lf-card">
            <h2 className="text-lg font-semibold mb-3">Per gebruiker</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-4 font-medium">Gebruiker</th>
                    <th className="py-2 pr-4 font-medium">Logins</th>
                    <th className="py-2 pr-4 font-medium">Laatste login</th>
                    <th className="py-2 pr-4 font-medium">Acties (periode)</th>
                    <th className="py-2 pr-4 font-medium">Exports (periode)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perUser.map((u) => (
                    <tr key={u.id} className="border-b border-slate-100">
                      <td className="py-2 pr-4">
                        <div className="font-medium">{u.name}</div>
                        <div className="text-xs text-slate-400">{u.email}</div>
                      </td>
                      <td className="py-2 pr-4 text-slate-600">{u.loginCount}</td>
                      <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">
                        {fmtDateTime(u.lastLoginAt)}
                      </td>
                      <td className="py-2 pr-4 text-slate-600">{u.actions}</td>
                      <td className="py-2 pr-4 text-slate-600">{u.exports}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

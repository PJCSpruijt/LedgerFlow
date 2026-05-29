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

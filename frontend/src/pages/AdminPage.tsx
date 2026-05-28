import { useEffect, useState } from "react";
import { api, ApiError } from "../services/api";

interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  platformRole: "PLATFORM_ADMIN" | "USER";
  createdAt: string;
  membershipCount: number;
}

interface AdminEntity {
  id: string;
  name: string;
  yuki: { environment: string; lastTestedAt: string | null; lastSyncAt: string | null } | null;
}
interface AdminGroup {
  id: string;
  name: string;
  entities: AdminEntity[];
}
interface AdminWorkspace {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  memberCount: number;
  subscription: { plan: string | null; status: string; validUntil: string | null } | null;
  groups: AdminGroup[];
}

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("nl-NL") : "—");
const fmtDateTime = (s: string | null) => (s ? new Date(s).toLocaleString("nl-NL") : "—");

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="lf-card">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
    </div>
  );
}

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [u, w] = await Promise.all([
          api<{ users: AdminUser[] }>("/api/admin/users"),
          api<{ workspaces: AdminWorkspace[] }>("/api/admin/workspaces"),
        ]);
        setUsers(u.users);
        setWorkspaces(w.workspaces);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Kon beheergegevens niet laden");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const entityCount = workspaces.reduce(
    (n, w) => n + w.groups.reduce((m, g) => m + g.entities.length, 0),
    0,
  );
  const activeSubs = workspaces.filter(
    (w) => w.subscription?.status === "ACTIVE" || w.subscription?.status === "TRIALING",
  ).length;

  if (loading) return <div className="lf-card">Beheergegevens laden…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Beheer</h1>
        <p className="text-sm text-slate-500 mt-1">
          Platformoverzicht van gebruikers, werkruimtes en administraties.
        </p>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Gebruikers" value={users.length} />
        <StatCard label="Werkruimtes" value={workspaces.length} />
        <StatCard label="Administraties" value={entityCount} />
        <StatCard label="Actieve abonnementen" value={activeSubs} />
      </div>

      <div className="lf-card">
        <h2 className="text-lg font-semibold mb-3">Gebruikers</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4 font-medium">Naam</th>
                <th className="py-2 pr-4 font-medium">E-mail</th>
                <th className="py-2 pr-4 font-medium">Platformrol</th>
                <th className="py-2 pr-4 font-medium">Memberships</th>
                <th className="py-2 pr-4 font-medium">Aangemaakt</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4">
                    {u.firstName} {u.lastName}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">{u.email}</td>
                  <td className="py-2 pr-4">
                    {u.platformRole === "PLATFORM_ADMIN" ? (
                      <span className="lf-pill bg-purple-100 text-purple-800">Platform admin</span>
                    ) : (
                      <span className="lf-pill bg-slate-200 text-slate-700">Gebruiker</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">{u.membershipCount}</td>
                  <td className="py-2 pr-4 text-slate-600">{fmtDate(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="lf-card">
        <h2 className="text-lg font-semibold mb-3">Werkruimtes &amp; administraties</h2>
        <div className="space-y-5">
          {workspaces.map((ws) => (
            <div key={ws.id} className="border border-slate-200 rounded-lg p-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold">{ws.name}</div>
                  <div className="text-xs text-slate-500">
                    {ws.type} · {ws.memberCount} {ws.memberCount === 1 ? "lid" : "leden"} · aangemaakt{" "}
                    {fmtDate(ws.createdAt)}
                  </div>
                </div>
                <div className="text-xs">
                  {ws.subscription ? (
                    <span className="text-slate-600">
                      {ws.subscription.plan ?? "Geen plan"} — {ws.subscription.status}
                    </span>
                  ) : (
                    <span className="text-slate-400">Geen abonnement</span>
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-3">
                {ws.groups.map((g) => (
                  <div key={g.id} className="pl-3 border-l-2 border-slate-200">
                    <div className="text-sm font-medium text-slate-700">{g.name}</div>
                    {g.entities.length === 0 ? (
                      <div className="text-xs text-slate-400 mt-1">Geen administraties</div>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {g.entities.map((e) => (
                          <li key={e.id} className="text-sm flex items-center gap-2">
                            <span>{e.name}</span>
                            {e.yuki ? (
                              <span
                                className="lf-pill bg-emerald-100 text-emerald-800"
                                title={`Laatst getest: ${fmtDateTime(e.yuki.lastTestedAt)} · Laatste sync: ${fmtDateTime(e.yuki.lastSyncAt)}`}
                              >
                                Yuki ({e.yuki.environment})
                              </span>
                            ) : (
                              <span className="lf-pill bg-slate-200 text-slate-600">
                                Niet gekoppeld
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

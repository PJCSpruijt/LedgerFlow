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
  connection: {
    kind: "YUKI" | "EBOEKHOUDEN";
    environment: string;
    lastTestedAt: string | null;
    lastSyncAt: string | null;
  } | null;
}

const CONNECTION_LABEL: Record<string, string> = { YUKI: "Yuki", EBOEKHOUDEN: "e-Boekhouden" };
interface AdminGroup {
  id: string;
  name: string;
  entities: AdminEntity[];
}
interface WorkspaceSubscription {
  status: string;
  validUntil: string | null;
  planId: string | null;
  planKey: string | null;
  planName: string | null;
}
interface AdminWorkspace {
  id: string;
  name: string;
  type: string;
  createdAt: string;
  memberCount: number;
  subscription: WorkspaceSubscription | null;
  groups: AdminGroup[];
}
interface AdminPlan {
  id: string;
  key: string;
  name: string;
  active: boolean;
}

const STATUSES = [
  "NONE",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "UNPAID",
  "INCOMPLETE",
  "INCOMPLETE_EXPIRED",
  "PAUSED",
];

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

function SubscriptionEditor({
  workspace,
  plans,
  onSaved,
}: {
  workspace: AdminWorkspace;
  plans: AdminPlan[];
  onSaved: () => void | Promise<void>;
}) {
  const sub = workspace.subscription;
  const [planId, setPlanId] = useState<string>(sub?.planId ?? "");
  const [status, setStatus] = useState<string>(sub?.status ?? "NONE");
  const [validUntil, setValidUntil] = useState<string>(
    sub?.validUntil ? sub.validUntil.slice(0, 10) : "",
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const save = async () => {
    setErr(null);
    setOk(false);
    setBusy(true);
    try {
      await api(`/api/admin/workspaces/${workspace.id}/subscription`, {
        method: "PATCH",
        body: {
          planId: planId || null,
          status,
          validUntil: validUntil ? new Date(validUntil).toISOString() : null,
        },
      });
      setOk(true);
      await onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-md bg-slate-50 border border-slate-200 p-3">
      <div className="text-xs font-medium text-slate-500 mb-2">Abonnement toewijzen</div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">Plan</span>
          <select className="lf-input text-xs" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            <option value="">Geen plan</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.active ? "" : " (inactief)"}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">Status</span>
          <select
            className="lf-input text-xs"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">Geldig tot</span>
          <input
            type="date"
            className="lf-input text-xs"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </label>
        <button className="lf-btn-primary text-xs" onClick={save} disabled={busy}>
          {busy ? "Opslaan…" : "Opslaan"}
        </button>
        {ok && <span className="text-xs text-emerald-600">Opgeslagen</span>}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}

function NewWorkspaceForm({
  users,
  onCreated,
  onCancel,
}: {
  users: AdminUser[];
  onCreated: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"COMPANY" | "ACCOUNTING_FIRM">("COMPANY");
  const [groupName, setGroupName] = useState("");
  const [entityName, setEntityName] = useState("");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api("/api/admin/workspaces", {
        method: "POST",
        body: {
          name: name.trim(),
          type,
          groupName: groupName.trim() || undefined,
          entityName: entityName.trim() || undefined,
          ownerUserId: ownerUserId || undefined,
        },
      });
      await onCreated();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Aanmaken mislukt");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-4 rounded-md bg-slate-50 border border-slate-200 p-4 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="lf-label">Naam werkruimte</label>
          <input className="lf-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="lf-label">Type</label>
          <select
            className="lf-input"
            value={type}
            onChange={(e) => setType(e.target.value as "COMPANY" | "ACCOUNTING_FIRM")}
          >
            <option value="COMPANY">Bedrijf</option>
            <option value="ACCOUNTING_FIRM">Accountantskantoor</option>
          </select>
        </div>
        <div>
          <label className="lf-label">Groepnaam (optioneel)</label>
          <input
            className="lf-input"
            placeholder={name || "= naam werkruimte"}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
          />
        </div>
        <div>
          <label className="lf-label">Eerste administratie (optioneel)</label>
          <input
            className="lf-input"
            placeholder={name || "= naam werkruimte"}
            value={entityName}
            onChange={(e) => setEntityName(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          <label className="lf-label">Eigenaar (optioneel)</label>
          <select
            className="lf-input"
            value={ownerUserId}
            onChange={(e) => setOwnerUserId(e.target.value)}
          >
            <option value="">Geen (alleen platformbeheerders zien deze werkruimte)</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.firstName} {u.lastName} — {u.email}
              </option>
            ))}
          </select>
        </div>
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      <div className="flex gap-3">
        <button className="lf-btn-primary" onClick={save} disabled={busy || !name.trim()}>
          {busy ? "Aanmaken…" : "Werkruimte aanmaken"}
        </button>
        <button className="lf-btn-secondary" onClick={onCancel} disabled={busy}>
          Annuleren
        </button>
      </div>
    </div>
  );
}

export function AdminPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [plans, setPlans] = useState<AdminPlan[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNewWs, setShowNewWs] = useState(false);
  const [editWs, setEditWs] = useState<{ id: string; name: string; type: string } | null>(null);
  const [moveEntityId, setMoveEntityId] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await loadWorkspaces();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Actie mislukt");
    }
  };

  const saveWs = () =>
    run(async () => {
      if (!editWs) return;
      await api(`/api/admin/workspaces/${editWs.id}`, {
        method: "PATCH",
        body: { name: editWs.name, type: editWs.type },
      });
      setEditWs(null);
    });
  const deleteWs = (ws: AdminWorkspace) =>
    run(async () => {
      if (!window.confirm(`Werkruimte "${ws.name}" en ALLES eronder verwijderen?`)) return;
      await api(`/api/admin/workspaces/${ws.id}`, { method: "DELETE" });
    });
  const addGroup = (ws: AdminWorkspace) =>
    run(async () => {
      const name = window.prompt("Naam van de nieuwe groep:");
      if (!name?.trim()) return;
      await api(`/api/admin/workspaces/${ws.id}/groups`, { method: "POST", body: { name: name.trim() } });
    });
  const renameGroup = (g: AdminGroup) =>
    run(async () => {
      const name = window.prompt("Nieuwe groepnaam:", g.name);
      if (!name?.trim() || name === g.name) return;
      await api(`/api/admin/groups/${g.id}`, { method: "PATCH", body: { name: name.trim() } });
    });
  const deleteGroup = (g: AdminGroup) =>
    run(async () => {
      if (!window.confirm(`Groep "${g.name}" en de administraties erin verwijderen?`)) return;
      await api(`/api/admin/groups/${g.id}`, { method: "DELETE" });
    });
  const addEntity = (g: AdminGroup) =>
    run(async () => {
      const name = window.prompt("Naam van de nieuwe administratie:");
      if (!name?.trim()) return;
      await api(`/api/admin/groups/${g.id}/entities`, { method: "POST", body: { name: name.trim() } });
    });
  const renameEntity = (e: AdminEntity) =>
    run(async () => {
      const name = window.prompt("Nieuwe naam administratie:", e.name);
      if (!name?.trim() || name === e.name) return;
      await api(`/api/admin/entities/${e.id}`, { method: "PATCH", body: { name: name.trim() } });
    });
  const deleteEntity = (e: AdminEntity) =>
    run(async () => {
      if (!window.confirm(`Administratie "${e.name}" verwijderen?`)) return;
      await api(`/api/admin/entities/${e.id}`, { method: "DELETE" });
    });
  const moveEntity = (e: AdminEntity, targetGroupId: string) =>
    run(async () => {
      await api(`/api/admin/entities/${e.id}/move`, {
        method: "PATCH",
        body: { targetGroupId },
      });
      setMoveEntityId(null);
    });

  // Flat list of all groups across workspaces, for the move target picker.
  const allGroups = workspaces.flatMap((w) =>
    w.groups.map((g) => ({ id: g.id, label: `${w.name} › ${g.name}` })),
  );

  const loadWorkspaces = async () => {
    const w = await api<{ workspaces: AdminWorkspace[] }>("/api/admin/workspaces");
    setWorkspaces(w.workspaces);
  };

  useEffect(() => {
    void (async () => {
      try {
        const [u, , p] = await Promise.all([
          api<{ users: AdminUser[] }>("/api/admin/users"),
          loadWorkspaces(),
          api<{ plans: AdminPlan[] }>("/api/admin/plans"),
        ]);
        setUsers(u.users);
        setPlans(p.plans);
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
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Werkruimtes &amp; administraties</h2>
          <button
            className="lf-btn-primary"
            onClick={() => setShowNewWs((v) => !v)}
            disabled={showNewWs}
          >
            + Nieuwe werkruimte
          </button>
        </div>
        {showNewWs && (
          <NewWorkspaceForm
            users={users}
            onCancel={() => setShowNewWs(false)}
            onCreated={async () => {
              setShowNewWs(false);
              await loadWorkspaces();
            }}
          />
        )}
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
                      {ws.subscription.planName ?? "Geen plan"} — {ws.subscription.status}
                      {ws.subscription.validUntil
                        ? ` (tot ${fmtDate(ws.subscription.validUntil)})`
                        : ""}
                    </span>
                  ) : (
                    <span className="text-slate-400">Geen abonnement</span>
                  )}
                </div>
              </div>

              <div className="mt-2 flex flex-wrap gap-4 text-xs">
                <button
                  className="lf-link"
                  onClick={() => setEditWs({ id: ws.id, name: ws.name, type: ws.type })}
                >
                  Bewerken
                </button>
                <button className="lf-link" onClick={() => addGroup(ws)}>
                  + Groep
                </button>
                <button className="text-red-600 hover:underline" onClick={() => deleteWs(ws)}>
                  Verwijderen
                </button>
              </div>

              {editWs?.id === ws.id && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <input
                    className="lf-input text-xs"
                    value={editWs.name}
                    onChange={(e) => setEditWs({ ...editWs, name: e.target.value })}
                  />
                  <select
                    className="lf-input text-xs"
                    value={editWs.type}
                    onChange={(e) => setEditWs({ ...editWs, type: e.target.value })}
                  >
                    <option value="COMPANY">Bedrijf</option>
                    <option value="ACCOUNTING_FIRM">Accountantskantoor</option>
                  </select>
                  <button className="lf-btn-primary text-xs" onClick={saveWs}>
                    Opslaan
                  </button>
                  <button className="lf-btn-secondary text-xs" onClick={() => setEditWs(null)}>
                    Annuleren
                  </button>
                </div>
              )}

              <SubscriptionEditor workspace={ws} plans={plans} onSaved={loadWorkspaces} />

              <div className="mt-3 space-y-3">
                {ws.groups.map((g) => (
                  <div key={g.id} className="pl-3 border-l-2 border-slate-200">
                    <div className="flex items-center gap-3">
                      <div className="text-sm font-medium text-slate-700">{g.name}</div>
                      <button className="lf-link text-xs" onClick={() => renameGroup(g)}>
                        Hernoemen
                      </button>
                      <button className="lf-link text-xs" onClick={() => addEntity(g)}>
                        + Administratie
                      </button>
                      <button
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => deleteGroup(g)}
                      >
                        Verwijderen
                      </button>
                    </div>
                    {g.entities.length === 0 ? (
                      <div className="text-xs text-slate-400 mt-1">Geen administraties</div>
                    ) : (
                      <ul className="mt-1 space-y-1">
                        {g.entities.map((e) => (
                          <li key={e.id} className="text-sm flex items-center gap-2 flex-wrap">
                            <span>{e.name}</span>
                            {e.connection ? (
                              <span
                                className="lf-pill bg-emerald-100 text-emerald-800"
                                title={`Laatst getest: ${fmtDateTime(e.connection.lastTestedAt)} · Laatste sync: ${fmtDateTime(e.connection.lastSyncAt)}`}
                              >
                                {CONNECTION_LABEL[e.connection.kind] ?? e.connection.kind}
                                {e.connection.kind === "YUKI" ? ` (${e.connection.environment})` : ""}
                              </span>
                            ) : (
                              <span className="lf-pill bg-slate-200 text-slate-600">
                                Niet gekoppeld
                              </span>
                            )}
                            <button className="lf-link text-xs" onClick={() => renameEntity(e)}>
                              Hernoemen
                            </button>
                            <button
                              className="lf-link text-xs"
                              onClick={() => setMoveEntityId(moveEntityId === e.id ? null : e.id)}
                            >
                              Verplaatsen
                            </button>
                            <button
                              className="text-xs text-red-600 hover:underline"
                              onClick={() => deleteEntity(e)}
                            >
                              Verwijderen
                            </button>
                            {moveEntityId === e.id && (
                              <span className="flex items-center gap-2 basis-full mt-1">
                                <span className="text-xs text-slate-500">Naar groep:</span>
                                <select
                                  className="lf-input text-xs w-72"
                                  defaultValue=""
                                  onChange={(ev) => {
                                    if (ev.target.value) moveEntity(e, ev.target.value);
                                  }}
                                >
                                  <option value="" disabled>
                                    Kies doelgroep…
                                  </option>
                                  {allGroups
                                    .filter((grp) => grp.id !== g.id)
                                    .map((grp) => (
                                      <option key={grp.id} value={grp.id}>
                                        {grp.label}
                                      </option>
                                    ))}
                                </select>
                                <button
                                  className="text-xs text-slate-500 hover:underline"
                                  onClick={() => setMoveEntityId(null)}
                                >
                                  Annuleren
                                </button>
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

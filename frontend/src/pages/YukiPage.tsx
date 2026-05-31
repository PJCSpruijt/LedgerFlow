import { useEffect, useState } from "react";
import { api, ApiError } from "../services/api";
import { isAdminRole, useScope } from "../contexts/ScopeContext";
import { ConnectorWizard } from "../components/ConnectorWizard";

type Kind = "yuki" | "eboekhouden";
type DbKind = "YUKI" | "EBOEKHOUDEN";

interface ConnectionInfo {
  id?: string;
  kind: DbKind;
  environment: "PRODUCTION" | "SANDBOX";
  lastTestedAt: string | null;
  lastSyncAt: string | null;
  updatedAt: string;
}
interface ConnSummary {
  kind: DbKind;
  environment: "PRODUCTION" | "SANDBOX";
  lastTestedAt: string | null;
  lastSyncAt: string | null;
}
interface WorkspaceConn {
  entityId: string;
  entityName: string;
  groupName: string;
  connection: ConnSummary | null;
}
interface TestResult {
  ok: boolean;
  message: string;
  administrations?: { id: string; name: string }[];
}

const envLabel = (e: string) => (e === "SANDBOX" ? "Sandbox" : "Productie");

function ConnectorBadge({ kind }: { kind: DbKind }) {
  const cfg =
    kind === "YUKI"
      ? { label: "Yuki", letter: "Y", cls: "bg-sky-100 text-sky-700" }
      : { label: "e-Boekhouden", letter: "e", cls: "bg-emerald-100 text-emerald-700" };
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-5 w-5 rounded ${cfg.cls} flex items-center justify-center text-xs font-bold`}>
        {cfg.letter}
      </span>
      {cfg.label}
    </span>
  );
}

const StatusBadge = ({ connected }: { connected: boolean }) =>
  connected ? (
    <span className="lf-pill bg-emerald-100 text-emerald-800">Verbonden</span>
  ) : (
    <span className="lf-pill bg-slate-100 text-slate-500">Niet verbonden</span>
  );

export function YukiPage() {
  const { entity, workspace, reload, selectEntity } = useScope();
  const [view, setView] = useState<"entity" | "workspace">("entity");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [bump, setBump] = useState(0);
  const [all, setAll] = useState<WorkspaceConn[] | null>(null);

  const [conn, setConn] = useState<ConnectionInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [kind, setKind] = useState<Kind>("yuki");
  const [form, setForm] = useState({
    accessKey: "",
    administrationId: "",
    environment: "PRODUCTION" as "PRODUCTION" | "SANDBOX",
    accessToken: "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  const canEdit = isAdminRole(entity?.role);

  // Single-entity connection.
  useEffect(() => {
    setTest(null);
    if (!entity) {
      setConn(null);
      return;
    }
    void (async () => {
      try {
        const r = await api<{ connection: ConnectionInfo | null }>("/api/yuki/connection");
        setConn(r.connection);
        setEditing(!r.connection); // no connection → open the form straight away
        if (r.connection) setKind(r.connection.kind === "EBOEKHOUDEN" ? "eboekhouden" : "yuki");
      } catch {
        /* ignore */
      }
    })();
  }, [entity?.id, bump]);

  // Workspace overview.
  const loadAll = async () => {
    try {
      const r = await api<{ connections: WorkspaceConn[] }>("/api/yuki/connections");
      setAll(r.connections);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kon koppelingen niet laden");
    }
  };
  useEffect(() => {
    if (view === "workspace") void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, workspace?.id]);

  const save = async () => {
    setMsg(null);
    setErr(null);
    setSaving(true);
    try {
      const body =
        kind === "yuki"
          ? { kind, accessKey: form.accessKey, administrationId: form.administrationId, environment: form.environment }
          : { kind, accessToken: form.accessToken };
      const saved = await api<{ administrationName: string | null }>("/api/yuki/connection", {
        method: "PUT",
        body,
      });
      setMsg(
        saved.administrationName
          ? `Koppeling opgeslagen — administratie: ${saved.administrationName}`
          : "Koppeling opgeslagen",
      );
      setForm({ ...form, accessKey: "", accessToken: "" });
      const r = await api<{ connection: ConnectionInfo | null }>("/api/yuki/connection");
      setConn(r.connection);
      setEditing(false);
      await reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  };

  const testConn = async () => {
    setTest(null);
    setErr(null);
    setTesting(true);
    try {
      setTest(await api<TestResult>("/api/yuki/test-connection"));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Test mislukt");
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Koppeling loskoppelen?")) return;
    await api("/api/yuki/connection", { method: "DELETE" });
    setConn(null);
    setEditing(true);
  };

  const manage = (entityId: string) => {
    selectEntity(entityId);
    setView("entity");
  };

  return (
    <div className="space-y-6">
      {wizardOpen && <ConnectorWizard onClose={() => { setWizardOpen(false); setBump((b) => b + 1); }} />}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Koppelingen</h1>
          <p className="text-sm text-slate-500 mt-1">
            Koppel administraties aan Yuki of e-Boekhouden.
          </p>
        </div>
        <div className="flex items-center gap-2">
        {entity && canEdit && (
          <button className="lf-btn-primary text-xs" onClick={() => setWizardOpen(true)}>
            ⚙️ Koppeling instellen (wizard)
          </button>
        )}
        <div className="inline-flex rounded-md border border-slate-200 overflow-hidden text-xs">
          <button
            className={`px-3 py-1.5 ${view === "entity" ? "bg-brand-50 text-brand-700 font-medium" : "text-slate-500 hover:bg-slate-50"}`}
            onClick={() => setView("entity")}
          >
            Deze administratie
          </button>
          <button
            className={`px-3 py-1.5 ${view === "workspace" ? "bg-brand-50 text-brand-700 font-medium" : "text-slate-500 hover:bg-slate-50"}`}
            onClick={() => setView("workspace")}
          >
            Hele werkruimte
          </button>
        </div>
        </div>
      </div>

      {/* ---- Workspace overview ---- */}
      {view === "workspace" && (
        <div className="lf-card p-0">
          <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-100">
            {all ? `${all.length} administraties` : "Laden…"}
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="py-2 px-3 font-medium">Administratie</th>
                  <th className="py-2 px-3 font-medium">Groep</th>
                  <th className="py-2 px-3 font-medium">Status</th>
                  <th className="py-2 px-3 font-medium">Koppeling</th>
                  <th className="py-2 px-3 font-medium">Omgeving</th>
                  <th className="py-2 px-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {(all ?? []).map((c) => (
                  <tr key={c.entityId} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-2 px-3 font-medium">{c.entityName}</td>
                    <td className="py-2 px-3 text-slate-500">{c.groupName}</td>
                    <td className="py-2 px-3">
                      <StatusBadge connected={!!c.connection} />
                    </td>
                    <td className="py-2 px-3">
                      {c.connection ? <ConnectorBadge kind={c.connection.kind} /> : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="py-2 px-3 text-slate-600">
                      {c.connection?.kind === "YUKI" ? envLabel(c.connection.environment) : "—"}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button className="lf-link" onClick={() => manage(c.entityId)}>
                        Beheren
                      </button>
                    </td>
                  </tr>
                ))}
                {all && all.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-3 px-3 text-slate-400">
                      Geen administraties in deze werkruimte.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- Single administration ---- */}
      {view === "entity" && !entity && (
        <div className="lf-card max-w-2xl">
          Selecteer een administratie in de bovenbalk, of bekijk het werkruimte-overzicht hierboven.
        </div>
      )}

      {view === "entity" && entity && (
        <>
          <div className="lf-card max-w-2xl">
            <div className="flex items-start justify-between gap-4">
              <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
                <span className="text-slate-500">Administratie</span>
                <span className="font-medium">{entity.name}</span>
                <span className="text-slate-500">Status</span>
                <span>
                  <StatusBadge connected={!!conn} />
                </span>
                {conn && (
                  <>
                    <span className="text-slate-500">Koppeling</span>
                    <span>
                      <ConnectorBadge kind={conn.kind} />
                    </span>
                    {conn.kind === "YUKI" && (
                      <>
                        <span className="text-slate-500">Omgeving</span>
                        <span>{envLabel(conn.environment)}</span>
                      </>
                    )}
                    {conn.lastTestedAt && (
                      <>
                        <span className="text-slate-500">Laatst getest</span>
                        <span className="text-slate-600">
                          {new Date(conn.lastTestedAt).toLocaleString("nl-NL")}
                        </span>
                      </>
                    )}
                  </>
                )}
              </div>
              <div className="flex flex-col gap-2 shrink-0">
                {conn && (
                  <button className="lf-btn-secondary" onClick={testConn} disabled={testing}>
                    {testing ? "Testen…" : "Test verbinding"}
                  </button>
                )}
                {conn && canEdit && !editing && (
                  <button className="lf-btn-secondary" onClick={() => setEditing(true)}>
                    Wijzig koppeling
                  </button>
                )}
                {conn && canEdit && (
                  <button className="lf-btn-danger" onClick={disconnect}>
                    Loskoppelen
                  </button>
                )}
              </div>
            </div>

            {test && (
              <div className={`mt-4 text-sm ${test.ok ? "text-emerald-700" : "text-red-600"}`}>
                {test.message}
                {test.administrations && test.administrations.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-slate-700">
                    {test.administrations.map((a) => (
                      <li key={a.id}>
                        {a.name} <span className="text-xs text-slate-500">({a.id})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {canEdit && editing && (
            <div className="lf-card max-w-2xl space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{conn ? "Wijzig koppeling" : "Nieuwe koppeling"}</h2>
                {conn && (
                  <button className="lf-link text-xs" onClick={() => setEditing(false)}>
                    Annuleren
                  </button>
                )}
              </div>

              <div>
                <label className="lf-label">Koppelingstype</label>
                <select className="lf-input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                  <option value="yuki">Yuki</option>
                  <option value="eboekhouden">e-Boekhouden</option>
                </select>
              </div>

              {kind === "yuki" ? (
                <>
                  <div>
                    <label className="lf-label">Web service API-key</label>
                    <input
                      className="lf-input font-mono text-xs"
                      type="password"
                      placeholder="07b46e02-1014-4884-8bfa-…"
                      value={form.accessKey}
                      onChange={(e) => setForm({ ...form, accessKey: e.target.value })}
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Genereer deze in Yuki via Instellingen → Web services → Web service API-key.
                    </p>
                  </div>
                  <div>
                    <label className="lf-label">Administration ID (UUID)</label>
                    <input
                      className="lf-input font-mono text-xs"
                      placeholder="51f30965-f7e2-44d7-9a40-…"
                      value={form.administrationId}
                      onChange={(e) => setForm({ ...form, administrationId: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="lf-label">Omgeving</label>
                    <select
                      className="lf-input"
                      value={form.environment}
                      onChange={(e) =>
                        setForm({ ...form, environment: e.target.value as "PRODUCTION" | "SANDBOX" })
                      }
                    >
                      <option value="PRODUCTION">Productie</option>
                      <option value="SANDBOX">Sandbox</option>
                    </select>
                  </div>
                </>
              ) : (
                <div>
                  <label className="lf-label">e-Boekhouden API-token</label>
                  <input
                    className="lf-input font-mono text-xs"
                    type="password"
                    placeholder="API-token uit e-Boekhouden"
                    value={form.accessToken}
                    onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Maak deze in e-Boekhouden via Beheer → Instellingen → API/koppelingen.
                  </p>
                </div>
              )}

              {msg && <div className="text-sm text-emerald-700">{msg}</div>}
              {err && <div className="text-sm text-red-600">{err}</div>}

              <button className="lf-btn-primary" onClick={save} disabled={saving}>
                {saving ? "Bezig…" : "Opslaan"}
              </button>
              <p className="text-xs text-slate-500">
                Credentials worden versleuteld opgeslagen (AES-256-GCM) en nooit teruggegeven aan de
                browser.
              </p>
            </div>
          )}

          {msg && !editing && <div className="text-sm text-emerald-700 max-w-2xl">{msg}</div>}
          {err && !editing && <div className="text-sm text-red-600 max-w-2xl">{err}</div>}
        </>
      )}
    </div>
  );
}

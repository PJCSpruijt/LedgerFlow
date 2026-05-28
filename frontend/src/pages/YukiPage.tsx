import { useEffect, useState } from "react";
import { api, ApiError } from "../services/api";
import { isAdminRole, useScope } from "../contexts/ScopeContext";

interface ConnectionInfo {
  id: string;
  environment: "PRODUCTION" | "SANDBOX";
  lastTestedAt: string | null;
  lastSyncAt: string | null;
  updatedAt: string;
}

interface TestResult {
  ok: boolean;
  message: string;
  administrations?: { id: string; name: string }[];
}

export function YukiPage() {
  const { entity, reload } = useScope();
  const [conn, setConn] = useState<ConnectionInfo | null>(null);
  const [form, setForm] = useState({
    accessKey: "",
    administrationId: "",
    environment: "PRODUCTION" as "PRODUCTION" | "SANDBOX",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!entity) {
      setConn(null);
      return;
    }
    void (async () => {
      try {
        const r = await api<{ connection: ConnectionInfo | null }>("/api/yuki/connection");
        setConn(r.connection);
      } catch {
        /* ignore */
      }
    })();
  }, [entity?.id]);

  const canEdit = isAdminRole(entity?.role);

  const save = async () => {
    setMsg(null);
    setErr(null);
    setSaving(true);
    try {
      const saved = await api<{ administrationName: string | null }>("/api/yuki/connection", {
        method: "PUT",
        body: form,
      });
      setMsg(
        saved.administrationName
          ? `Yuki-verbinding opgeslagen — administratie: ${saved.administrationName}`
          : "Yuki-verbinding opgeslagen",
      );
      setForm({ ...form, accessKey: "" });
      const r = await api<{ connection: ConnectionInfo | null }>("/api/yuki/connection");
      setConn(r.connection);
      // Refresh the scope tree so the entity's adopted Yuki name shows in the sidebar.
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
      const r = await api<TestResult>("/api/yuki/test-connection");
      setTest(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Test mislukt");
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Yuki-verbinding loskoppelen?")) return;
    await api("/api/yuki/connection", { method: "DELETE" });
    setConn(null);
  };

  if (!entity) {
    return (
      <div className="lf-card max-w-2xl">
        Selecteer een administratie in de zijbalk om de Yuki-koppeling te beheren.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Yuki-koppeling</h1>
        <p className="text-sm text-slate-500 mt-1">
          Verbind je Yuki-administratie met een Web service API-key en Administration ID.
        </p>
      </div>

      <div className="lf-card max-w-2xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-sm text-slate-500">Status</div>
            <div className="text-lg font-semibold mt-1">
              {conn ? `Verbonden (${conn.environment})` : "Niet verbonden"}
            </div>
            {conn?.lastTestedAt && (
              <div className="text-xs text-slate-500 mt-1">
                Laatst getest: {new Date(conn.lastTestedAt).toLocaleString("nl-NL")}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button className="lf-btn-secondary" onClick={testConn} disabled={testing}>
              {testing ? "Testen…" : "Test verbinding"}
            </button>
            {conn && canEdit && (
              <button className="lf-btn-danger" onClick={disconnect}>
                Loskoppelen
              </button>
            )}
          </div>
        </div>

        {test && (
          <div
            className={`mt-4 text-sm ${test.ok ? "text-emerald-700" : "text-red-600"}`}
          >
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

      {canEdit && (
        <div className="lf-card max-w-2xl space-y-4">
          <h2 className="text-lg font-semibold">
            {conn ? "Wijzig verbinding" : "Nieuwe verbinding"}
          </h2>

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
    </div>
  );
}

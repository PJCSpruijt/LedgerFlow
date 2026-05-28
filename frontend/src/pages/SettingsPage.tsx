import { useEffect, useState } from "react";
import { isAdminRole, useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";

export function SettingsPage() {
  const { workspace, role, reload } = useScope();
  const [name, setName] = useState(workspace?.name ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(workspace?.name ?? "");
  }, [workspace?.id, workspace?.name]);

  if (!workspace) return <div>Selecteer een werkruimte.</div>;

  const canEdit = isAdminRole(workspace.role);

  const save = async () => {
    setMsg(null);
    setErr(null);
    setSaving(true);
    try {
      await api("/api/workspaces/current", { method: "PATCH", body: { name } });
      await reload();
      setMsg("Opgeslagen");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Instellingen</h1>
        <p className="text-sm text-slate-500 mt-1">Werkruimteprofiel en gebruikersrol.</p>
      </div>
      <div className="lf-card max-w-xl space-y-4">
        <div>
          <label className="lf-label">Naam werkruimte</label>
          <input
            className="lf-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div>
          <label className="lf-label">Jouw rol</label>
          <div className="text-sm text-slate-700">{role}</div>
        </div>
        {msg && <div className="text-sm text-emerald-700">{msg}</div>}
        {err && <div className="text-sm text-red-600">{err}</div>}
        <button onClick={save} disabled={!canEdit || saving} className="lf-btn-primary">
          {saving ? "Bezig…" : "Opslaan"}
        </button>
      </div>
    </div>
  );
}

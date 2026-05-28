import { useState } from "react";
import { useOrg } from "../contexts/OrganizationContext";
import { api, ApiError } from "../services/api";

export function SettingsPage() {
  const { current, reload } = useOrg();
  const [name, setName] = useState(current?.name ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!current) return <div>Selecteer een organisatie.</div>;

  const canEdit = current.role === "OWNER" || current.role === "ADMIN";

  const save = async () => {
    setMsg(null);
    setErr(null);
    setSaving(true);
    try {
      await api("/api/organizations/current", { method: "PATCH", body: { name } });
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
        <p className="text-sm text-slate-500 mt-1">Organisatieprofiel en gebruikersrol.</p>
      </div>
      <div className="lf-card max-w-xl space-y-4">
        <div>
          <label className="lf-label">Naam organisatie</label>
          <input
            className="lf-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div>
          <label className="lf-label">Jouw rol</label>
          <div className="text-sm text-slate-700">{current.role}</div>
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

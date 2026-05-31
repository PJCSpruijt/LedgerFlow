import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../services/api";
import { isAdminRole, useScope } from "../contexts/ScopeContext";

interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  entityId: string | null;
  rateLimitPerMin: number;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("nl-NL") : "—");

/**
 * Rapportage → API-toegang: manage Output-API keys (external read-only access
 * for Power BI / Caseware / Visionplanner / Excel). The raw key is shown once.
 */
export function ApiKeysPage() {
  const { workspace } = useScope();
  const canEdit = isAdminRole(workspace?.role);
  const entities = useMemo(() => workspace?.groups.flatMap((g) => g.entities) ?? [], [workspace]);
  const entityName = (id: string | null) => (id ? entities.find((e) => e.id === id)?.name ?? id : "Hele werkruimte");

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", entityId: "", rateLimitPerMin: 120 });
  const [newKey, setNewKey] = useState<string | null>(null);

  const base = `${window.location.origin}/api/v1`;

  const load = async () => {
    try {
      const r = await api<{ keys: ApiKey[] }>("/api/api-keys");
      setKeys(r.keys);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kon sleutels niet laden");
    }
  };
  useEffect(() => {
    if (workspace) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace?.id]);

  const create = async () => {
    if (!form.name.trim()) return;
    setErr(null);
    setBusy(true);
    setNewKey(null);
    try {
      const r = await api<{ rawKey: string }>("/api/api-keys", {
        method: "POST",
        body: {
          name: form.name.trim(),
          entityId: form.entityId || null,
          rateLimitPerMin: form.rateLimitPerMin,
        },
      });
      setNewKey(r.rawKey);
      setForm({ name: "", entityId: "", rateLimitPerMin: 120 });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Aanmaken mislukt");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (k: ApiKey) => {
    if (!window.confirm(`Sleutel "${k.name}" intrekken? Externe systemen die deze gebruiken verliezen direct toegang.`)) return;
    setBusy(true);
    try {
      await api(`/api/api-keys/${k.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Intrekken mislukt");
    } finally {
      setBusy(false);
    }
  };

  const status = (k: ApiKey) =>
    k.revokedAt ? "Ingetrokken" : k.expiresAt && new Date(k.expiresAt) < new Date() ? "Verlopen" : "Actief";

  if (!workspace) return <div className="lf-card max-w-2xl">Selecteer een werkruimte.</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">API-toegang</h1>
        <p className="text-sm text-slate-500 mt-1">
          Geef externe software (Power BI, Caseware, Visionplanner, Excel) <b>alleen-lezen</b> toegang
          tot de genormaliseerde data van FIN//HUB via de Output API. Stuur de sleutel mee als{" "}
          <code className="font-mono text-xs bg-slate-100 px-1 rounded">X-API-Key</code>-header.
        </p>
      </div>

      <div className="lf-card text-sm space-y-1">
        <div>
          <span className="text-slate-500">Basis-URL: </span>
          <code className="font-mono">{base}</code>
        </div>
        <div>
          <span className="text-slate-500">OpenAPI: </span>
          <a className="lf-link" href={`${base}/openapi.json`} target="_blank" rel="noreferrer">
            {base}/openapi.json
          </a>
        </div>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      {newKey && (
        <div className="lf-card bg-emerald-50 ring-emerald-200">
          <div className="text-sm font-medium text-emerald-900">
            Nieuwe sleutel aangemaakt — kopieer 'm nu, hij wordt later niet meer getoond:
          </div>
          <div className="mt-2 flex items-center gap-2">
            <code className="font-mono text-sm bg-white px-2 py-1 rounded ring-1 ring-emerald-200 break-all">{newKey}</code>
            <button className="lf-btn-secondary text-xs" onClick={() => navigator.clipboard?.writeText(newKey)}>
              Kopieer
            </button>
            <button className="lf-link text-xs" onClick={() => setNewKey(null)}>
              Sluiten
            </button>
          </div>
        </div>
      )}

      {canEdit && (
        <div className="lf-card space-y-3">
          <h2 className="text-lg font-semibold">Sleutel aanmaken</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="lf-label">Naam</label>
              <input
                className="lf-input w-48"
                placeholder="Power BI – maandrapportage"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="lf-label">Bereik</label>
              <select
                className="lf-input"
                value={form.entityId}
                onChange={(e) => setForm({ ...form, entityId: e.target.value })}
              >
                <option value="">Hele werkruimte</option>
                {entities.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="lf-label">Limiet (calls/min)</label>
              <input
                type="number"
                className="lf-input w-28"
                value={form.rateLimitPerMin}
                onChange={(e) => setForm({ ...form, rateLimitPerMin: Number(e.target.value) || 120 })}
              />
            </div>
            <button className="lf-btn-primary" disabled={busy || !form.name.trim()} onClick={create}>
              Aanmaken
            </button>
          </div>
        </div>
      )}

      <div className="lf-card p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2 px-3 font-medium">Naam</th>
              <th className="py-2 px-3 font-medium">Sleutel</th>
              <th className="py-2 px-3 font-medium">Bereik</th>
              <th className="py-2 px-3 font-medium text-right">Limiet</th>
              <th className="py-2 px-3 font-medium">Laatst gebruikt</th>
              <th className="py-2 px-3 font-medium">Status</th>
              <th className="py-2 px-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} className="border-b border-slate-100">
                <td className="py-2 px-3">{k.name}</td>
                <td className="py-2 px-3 font-mono text-slate-500">{k.prefix}…</td>
                <td className="py-2 px-3 text-slate-600">{entityName(k.entityId)}</td>
                <td className="py-2 px-3 text-right text-slate-500">{k.rateLimitPerMin}/min</td>
                <td className="py-2 px-3 text-slate-500">{fmt(k.lastUsedAt)}</td>
                <td className="py-2 px-3">
                  <span
                    className={`lf-pill ${
                      status(k) === "Actief"
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {status(k)}
                  </span>
                </td>
                <td className="py-2 px-3 text-right">
                  {canEdit && !k.revokedAt && (
                    <button className="text-xs text-red-600 hover:underline" onClick={() => revoke(k)} disabled={busy}>
                      Intrekken
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 px-3 text-slate-400">
                  Nog geen API-sleutels.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

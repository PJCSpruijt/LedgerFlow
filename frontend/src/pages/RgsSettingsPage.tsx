import { useEffect, useState } from "react";
import { api, ApiError } from "../services/api";
import { isAdminRole, useScope } from "../contexts/ScopeContext";

interface Settings {
  rgsEnabled: boolean;
  rgsRequired: boolean;
  rgsVersion: string;
}

/** Instellingen → RGS / normalisatie: per-workspace RGS toggles. */
export function RgsSettingsPage() {
  const { workspace } = useScope();
  const canEdit = isAdminRole(workspace?.role);
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!workspace) return;
    api<{ settings: Settings }>("/api/workspace-settings")
      .then((r) => setS(r.settings))
      .catch((e) => setErr(e instanceof ApiError ? e.message : "Kon instellingen niet laden"));
  }, [workspace?.id]);

  const save = async (patch: Partial<Settings>) => {
    if (!s) return;
    const next = { ...s, ...patch };
    setS(next);
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      const r = await api<{ settings: Settings }>("/api/workspace-settings", { method: "PUT", body: patch });
      setS(r.settings);
      setSaved(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  };

  if (!workspace) return <div className="lf-card max-w-2xl">Selecteer een werkruimte.</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">RGS / normalisatie</h1>
        <p className="text-sm text-slate-500 mt-1">
          Het Referentie Grootboekschema (RGS) is de canonieke normalisatielaag: bronrekeningen
          worden gekoppeld aan RGS-codes zodat rapportage en consolidatie over administraties heen
          vergelijkbaar zijn. De RGS-details blijven in de Toewijzingen-module — niet in de gewone
          rapportages.
        </p>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}
      {!s && <div className="lf-card">Laden…</div>}

      {s && (
        <div className="lf-card space-y-4">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={s.rgsEnabled}
              disabled={!canEdit || busy}
              onChange={(e) => save({ rgsEnabled: e.target.checked })}
            />
            <span>
              <span className="font-medium">RGS inschakelen</span>
              <span className="block text-sm text-slate-500">
                Verrijk transacties en proefbalans met de gekoppelde RGS-code en FIN-categorie.
              </span>
            </span>
          </label>

          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={s.rgsRequired}
              disabled={!canEdit || busy || !s.rgsEnabled}
              onChange={(e) => save({ rgsRequired: e.target.checked })}
            />
            <span>
              <span className="font-medium">RGS verplicht</span>
              <span className="block text-sm text-slate-500">
                Ongekoppelde bronrekeningen worden gemarkeerd als datakwaliteitsprobleem.
              </span>
            </span>
          </label>

          <div>
            <label className="lf-label">RGS-versie</label>
            <input
              className="lf-input font-mono w-32"
              value={s.rgsVersion}
              disabled={!canEdit || busy}
              onChange={(e) => setS({ ...s, rgsVersion: e.target.value })}
              onBlur={(e) => save({ rgsVersion: e.target.value.trim() })}
            />
            <p className="text-xs text-slate-400 mt-1">
              De versie wordt geladen door een platformbeheerder (Platformbeheer → RGS-taxonomie). Is
              de gekozen versie niet geladen, dan valt het systeem terug op de nieuwste beschikbare.
            </p>
          </div>

          {saved && <div className="text-sm text-emerald-700">Opgeslagen.</div>}
          {!canEdit && <div className="text-xs text-amber-700">Alleen beheerders kunnen dit wijzigen.</div>}
        </div>
      )}
    </div>
  );
}

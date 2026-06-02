import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useScope } from "../contexts/ScopeContext";
import { api } from "../services/api";

/**
 * "Meld probleem"-dialoog. De gebruiker beschrijft alleen wat er misging; de app
 * stuurt automatisch context mee (route, module, werkruimte/administratie,
 * browser/scherm) — nooit gevoelige gegevens. De backend dedupliceert op een
 * fingerprint, dus herhaalde meldingen van hetzelfde probleem tellen op één
 * incident en de melder krijgt "dit is al bekend".
 */
export function ReportProblemModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  const { workspace, group, entity } = useScope();
  const [what, setWhat] = useState("");
  const [expected, setExpected] = useState("");
  const [severity, setSeverity] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("MEDIUM");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ duplicate: boolean; message: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!open) return null;
  const moduleKey = pathname.split("/").filter(Boolean)[0] ?? null;

  const submit = async () => {
    setErr(null);
    if (!what.trim()) { setErr("Beschrijf kort wat er misging."); return; }
    setBusy(true);
    try {
      const r = await api<{ duplicate: boolean; message: string }>("/api/incidents", {
        method: "POST",
        body: {
          title: what.trim().slice(0, 140),
          description: `Wat ging mis: ${what.trim()}${expected.trim() ? `\nVerwacht: ${expected.trim()}` : ""}`,
          severity,
          route: pathname,
          module: moduleKey,
          context: {
            workspaceId: workspace?.id ?? null,
            groupId: group?.id ?? null,
            entityId: entity?.id ?? null,
            workspaceName: workspace?.name ?? null,
            userAgent: navigator.userAgent,
            viewport: `${window.innerWidth}×${window.innerHeight}`,
            language: navigator.language,
            at: new Date().toISOString(),
          },
        },
      });
      setResult(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Melden mislukt");
    } finally {
      setBusy(false);
    }
  };

  const close = () => { setWhat(""); setExpected(""); setResult(null); setErr(null); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={close}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
        {result ? (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{result.duplicate ? "Al bekend" : "Bedankt!"}</h2>
            <p className="text-sm text-slate-600">{result.message}</p>
            <div className="text-right">
              <button className="lf-btn-primary text-sm" onClick={close}>Sluiten</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold">Probleem melden</h2>
              <p className="text-xs text-slate-500">
                We sturen automatisch context mee (huidige pagina, werkruimte, browser) — geen gevoelige gegevens.
              </p>
            </div>
            <label className="block text-sm">
              Wat ging er mis? <span className="text-rose-500">*</span>
              <textarea className="lf-input w-full h-20 text-sm mt-1" value={what} onChange={(e) => setWhat(e.target.value)} placeholder="Beschrijf wat je deed en wat er gebeurde" />
            </label>
            <label className="block text-sm">
              Wat verwachtte je? <span className="text-slate-400">(optioneel)</span>
              <textarea className="lf-input w-full h-16 text-sm mt-1" value={expected} onChange={(e) => setExpected(e.target.value)} />
            </label>
            <label className="block text-sm">
              Urgentie
              <select className="lf-input text-sm h-9 w-48 block mt-1" value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
                <option value="LOW">Laag</option>
                <option value="MEDIUM">Normaal</option>
                <option value="HIGH">Hoog</option>
                <option value="CRITICAL">Kritiek (werk geblokkeerd)</option>
              </select>
            </label>
            <div className="text-xs text-slate-400">Pagina: <span className="font-mono">{pathname}</span></div>
            {err && <div className="text-sm text-rose-600">{err}</div>}
            <div className="flex justify-end gap-2">
              <button className="text-sm text-slate-500 px-3" onClick={close}>Annuleren</button>
              <button className="lf-btn-primary text-sm" disabled={busy} onClick={submit}>Versturen</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

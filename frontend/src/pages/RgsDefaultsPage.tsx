import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api } from "../services/api";
import { ErrorNotice } from "../components/ErrorNotice";

interface FinCat { id: string; key: string; label: string }
interface DefaultRow { sourceAccountCode: string; rgsCode: string | null; finCategory: { id: string; key: string; label: string } | null; updatedAt: string }
interface DefaultsResult { version: string; defaults: DefaultRow[] }

/**
 * Workspace-wide RGS defaults + import/export. A default maps a source-account
 * code to an RGS code for the whole workspace; an administration inherits it
 * unless it has its own (entity-specific) mapping, which always wins.
 */
export function RgsDefaultsPage() {
  const { workspace } = useScope();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [rgsCode, setRgsCode] = useState("");
  const [finId, setFinId] = useState("");
  const [importText, setImportText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["rgs-defaults", workspace?.id],
    queryFn: () => api<DefaultsResult>("/api/rgs-mappings/defaults"),
    enabled: !!workspace,
  });
  const { data: cats } = useQuery({
    queryKey: ["fin-categories", workspace?.id],
    queryFn: () => api<{ categories: FinCat[] }>("/api/rgs-mappings/fin-categories"),
    enabled: !!workspace,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["rgs-defaults"] });
    qc.invalidateQueries({ queryKey: ["consolidation"] });
    qc.invalidateQueries({ queryKey: ["data-quality"] });
  };
  const setMut = useMutation({
    mutationFn: (b: { sourceAccountCode: string; rgsCode: string | null; finCategoryId: string | null }) =>
      api("/api/rgs-mappings/defaults", { method: "POST", body: b }),
    onSuccess: () => { setCode(""); setRgsCode(""); setFinId(""); setErr(null); setMsg("Standaard opgeslagen."); invalidate(); },
    onError: (e) => { setMsg(null); setErr(e instanceof Error ? e.message : "Opslaan mislukt"); },
  });
  const delMut = useMutation({
    mutationFn: (c: string) => api(`/api/rgs-mappings/defaults?code=${encodeURIComponent(c)}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const importMut = useMutation({
    mutationFn: (defaults: unknown[]) => api<{ imported: number; skipped: number }>("/api/rgs-mappings/import", { method: "POST", body: { defaults } }),
    onSuccess: (r) => { setImportText(""); setErr(null); setMsg(`Geïmporteerd: ${r.imported}, overgeslagen: ${r.skipped}.`); invalidate(); },
    onError: (e) => { setMsg(null); setErr(e instanceof Error ? e.message : "Import mislukt"); },
  });

  const submitAdd = () => {
    setErr(null); setMsg(null);
    if (!code.trim()) { setErr("Vul een grootboekcode in."); return; }
    if (!rgsCode.trim() && !finId) { setErr("Vul een RGS-code of FIN-categorie in."); return; }
    setMut.mutate({ sourceAccountCode: code.trim(), rgsCode: rgsCode.trim() || null, finCategoryId: finId || null });
  };

  const doExport = async () => {
    setErr(null);
    try {
      const doc = await api<unknown>("/api/rgs-mappings/export");
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rgs-mappings-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Export mislukt");
    }
  };

  const doImport = () => {
    setErr(null); setMsg(null);
    let parsed: unknown;
    try { parsed = JSON.parse(importText); } catch { setErr("Ongeldige JSON."); return; }
    // Accept either a full export doc ({defaults:[...]}) or a bare array.
    const arr = Array.isArray(parsed) ? parsed : (parsed as { defaults?: unknown[] })?.defaults;
    if (!Array.isArray(arr)) { setErr('Verwacht een array of een object met "defaults".'); return; }
    importMut.mutate(arr);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">RGS-standaarden, import & export</h1>
        <p className="text-sm text-slate-500 mt-1">
          Werkruimte-brede RGS-standaarden per grootboekcode. Een administratie erft de standaard, tenzij ze een eigen
          koppeling heeft — die wint altijd.
        </p>
      </div>

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte in de bovenbalk.</div>}
      {workspace && isLoading && <div className="lf-card">Standaarden laden…</div>}
      {isError && <ErrorNotice error={error} fallback="Kon standaarden niet laden" onRetry={() => refetch()} />}

      {msg && <div className="lf-card bg-emerald-50 ring-emerald-200 text-emerald-800 text-sm">{msg}</div>}
      {err && <div className="lf-card bg-rose-50 ring-rose-200 text-rose-700 text-sm">{err}</div>}

      {data && (
        <div className="lf-card max-w-3xl">
          <h2 className="text-base font-semibold mb-2">Standaard toevoegen / wijzigen</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">Grootboekcode
              <input className="lf-input h-9 text-sm w-40 block mt-0.5" placeholder="bijv. 1300" value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
            <label className="text-xs text-slate-500">RGS-code
              <input className="lf-input h-9 text-sm w-44 block mt-0.5 font-mono" placeholder="bijv. BVorDeb" value={rgsCode} onChange={(e) => setRgsCode(e.target.value)} />
            </label>
            <label className="text-xs text-slate-500">FIN-categorie (optioneel)
              <select className="lf-input h-9 text-sm w-48 block mt-0.5" value={finId} onChange={(e) => setFinId(e.target.value)}>
                <option value="">—</option>
                {cats?.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <button className="lf-btn-primary text-sm h-9" disabled={setMut.isPending} onClick={submitAdd}>Opslaan</button>
          </div>
        </div>
      )}

      {data && (
        <div className="lf-card">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold">Standaarden ({data.defaults.length})</h2>
            <button className="lf-btn-secondary text-sm" onClick={doExport}>⬇ Export (JSON)</button>
          </div>
          {data.defaults.length === 0 ? (
            <p className="text-sm text-slate-400">Nog geen werkruimte-standaarden.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 pr-4">Grootboekcode</th>
                  <th className="py-1.5 pr-4">RGS-code</th>
                  <th className="py-1.5 pr-4">FIN-categorie</th>
                  <th className="py-1.5 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {data.defaults.map((d) => (
                  <tr key={d.sourceAccountCode} className="border-b border-slate-50">
                    <td className="py-1.5 pr-4 font-mono text-slate-600">{d.sourceAccountCode}</td>
                    <td className="py-1.5 pr-4 font-mono text-slate-600">{d.rgsCode ?? "—"}</td>
                    <td className="py-1.5 pr-4 text-slate-500">{d.finCategory?.label ?? "—"}</td>
                    <td className="py-1.5 pr-4 text-right">
                      <button
                        className="text-xs text-slate-500 hover:underline mr-3"
                        onClick={() => { setCode(d.sourceAccountCode); setRgsCode(d.rgsCode ?? ""); setFinId(d.finCategory?.id ?? ""); }}
                      >
                        Bewerken
                      </button>
                      <button className="text-xs text-rose-600 hover:underline" disabled={delMut.isPending} onClick={() => delMut.mutate(d.sourceAccountCode)}>
                        Verwijderen
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {data && (
        <div className="lf-card max-w-3xl">
          <h2 className="text-base font-semibold mb-2">Importeren</h2>
          <p className="text-xs text-slate-500 mb-2">
            Plak een eerder geëxporteerd bestand, of een array zoals{" "}
            <code className="bg-slate-100 px-1 rounded">[{`{"sourceAccountCode":"1300","rgsCode":"BVorDeb"}`}]</code>. Bestaande
            standaarden met dezelfde code worden bijgewerkt.
          </p>
          <textarea
            className="lf-input text-xs font-mono w-full h-32"
            placeholder='{"defaults":[{"sourceAccountCode":"1300","rgsCode":"BVorDeb","finCategory":"MRR"}]}'
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <button className="lf-btn-primary text-sm mt-2" disabled={importMut.isPending || !importText.trim()} onClick={doImport}>
            Importeren
          </button>
        </div>
      )}
    </div>
  );
}

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../services/api";
import { isAdminRole, useScope } from "../contexts/ScopeContext";
import { RgsCodeSearch } from "../components/RgsCodeSearch";

interface Suggestion {
  rgsCode: string;
  description: string;
  level: number;
  score: number;
  source: "history" | "name";
}
interface Mapping {
  rgsCode: string | null;
  finCategoryId: string | null;
  finCategoryKey: string | null;
  confidence: string;
}
interface AccountRow {
  code: string;
  name: string;
  accountType: string;
  mapping: Mapping | null;
  suggestions: Suggestion[];
}
interface MappingResponse {
  version: string;
  accounts: AccountRow[];
}
interface FinCategory {
  id: string;
  key: string;
  label: string;
  kind: string;
  workspaceId: string | null;
}

const typeBadge = (t: string) =>
  t === "BALANCE" ? "Balans" : t === "PROFIT_LOSS" ? "W&V" : "—";

/** Toewijzingen → Rekeningkoppelingen (RGS): the mapping workbench. */
export function RgsMappingPage() {
  const { entity, workspace } = useScope();
  const canEdit = isAdminRole(entity?.role ?? workspace?.role);
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [history, setHistory] = useState<{ code: string; rows: unknown[] } | null>(null);
  const [unmappedOnly, setUnmappedOnly] = useState(false);
  const [q, setQ] = useState("");

  const key = ["rgs-mappings", entity?.id];
  const { data, isLoading, isError, error } = useQuery({
    queryKey: key,
    queryFn: () => api<MappingResponse>("/api/rgs-mappings"),
    enabled: !!entity,
  });
  const { data: cats } = useQuery({
    queryKey: ["rgs-fin-categories", workspace?.id],
    queryFn: () => api<{ categories: FinCategory[] }>("/api/rgs-mappings/fin-categories"),
    enabled: !!entity,
  });

  const sync = useMutation({
    mutationFn: () => api("/api/rgs-mappings/sync", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Ophalen mislukt"),
  });

  const setMap = useMutation({
    mutationFn: (vars: { code: string; rgsCode: string | null; finCategoryId: string | null; confidence: string }) =>
      api("/api/rgs-mappings", {
        method: "POST",
        body: {
          sourceAccountCode: vars.code,
          rgsCode: vars.rgsCode,
          finCategoryId: vars.finCategoryId,
          confidence: vars.confidence,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
    onError: (e) => setErr(e instanceof ApiError ? e.message : "Opslaan mislukt"),
  });

  // Apply a single field change while preserving the rest of the mapping.
  const apply = (row: AccountRow, patch: { rgsCode?: string | null; finCategoryId?: string | null }, confidence: string) => {
    setErr(null);
    setMap.mutate({
      code: row.code,
      rgsCode: patch.rgsCode !== undefined ? patch.rgsCode : (row.mapping?.rgsCode ?? null),
      finCategoryId:
        patch.finCategoryId !== undefined ? patch.finCategoryId : (row.mapping?.finCategoryId ?? null),
      confidence,
    });
  };

  const openHistory = async (code: string) => {
    try {
      const r = await api<{ history: unknown[] }>(`/api/rgs-mappings/history?code=${encodeURIComponent(code)}`);
      setHistory({ code, rows: r.history });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Historie laden mislukt");
    }
  };

  const accounts = data?.accounts ?? [];
  const mapped = accounts.filter((a) => a.mapping?.rgsCode).length;
  const term = q.trim().toLowerCase();
  const filtered = accounts.filter((a) => {
    if (unmappedOnly && a.mapping?.rgsCode) return false;
    if (term && !(a.code.toLowerCase().includes(term) || a.name.toLowerCase().includes(term))) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      {history && <HistoryModal code={history.code} rows={history.rows} onClose={() => setHistory(null)} />}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Rekeningkoppelingen (RGS)</h1>
          <p className="text-sm text-slate-500 mt-1">
            {entity ? `${entity.name}` : "Selecteer een administratie"}
            {data && ` · RGS ${data.version} · ${mapped}/${accounts.length} gekoppeld`}
          </p>
        </div>
        {canEdit && entity && (
          <button className="lf-btn-secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? "Ophalen…" : "Rekeningen ophalen"}
          </button>
        )}
      </div>

      {entity && accounts.length > 0 && (
        <div className="flex items-center gap-4 flex-wrap">
          <input
            className="lf-input text-sm h-9 w-64"
            placeholder="Zoek op code of naam…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={unmappedOnly} onChange={(e) => setUnmappedOnly(e.target.checked)} />
            Alleen niet-gekoppelde rekeningen
          </label>
          {(unmappedOnly || term) && (
            <span className="text-xs text-slate-400">{filtered.length} van {accounts.length} getoond</span>
          )}
        </div>
      )}

      {err && <div className="text-sm text-red-600">{err}</div>}
      {!entity && <div className="lf-card max-w-2xl">Selecteer een administratie in de bovenbalk.</div>}
      {entity && isLoading && <div className="lf-card">Laden…</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">
          {error instanceof ApiError ? error.message : "Kon rekeningen niet laden"}
        </div>
      )}

      {entity && data && accounts.length === 0 && (
        <div className="lf-card">
          Nog geen bronrekeningen ontdekt. Klik op <span className="font-medium">Rekeningen ophalen</span> om
          ze uit de koppeling te laden.
        </div>
      )}

      {entity && accounts.length > 0 && (
        <div className="lf-card p-0">
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 px-3 font-medium">Bronrekening</th>
                  <th className="py-2 px-3 font-medium">Type</th>
                  <th className="py-2 px-3 font-medium">RGS-koppeling</th>
                  <th className="py-2 px-3 font-medium">FIN-categorie</th>
                  <th className="py-2 px-3 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 px-3 text-slate-400">
                      {unmappedOnly ? "Alle rekeningen (in deze selectie) zijn gekoppeld 🎉" : "Geen rekeningen gevonden."}
                    </td>
                  </tr>
                )}
                {filtered.map((row) => (
                  <tr key={row.code} className="border-b border-slate-100 align-top">
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className="font-mono text-slate-500 mr-2">{row.code}</span>
                      {row.name}
                    </td>
                    <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{typeBadge(row.accountType)}</td>
                    <td className="py-2 px-3">
                      {row.mapping?.rgsCode ? (
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono bg-emerald-50 text-emerald-800 px-1.5 rounded">
                            {row.mapping.rgsCode}
                          </span>
                          <span className="lf-pill bg-slate-100 text-slate-600">{row.mapping.confidence}</span>
                          {canEdit && (
                            <button
                              className="text-slate-300 hover:text-red-500"
                              title="Koppeling wissen"
                              onClick={() => apply(row, { rgsCode: null }, "MANUAL")}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-400">niet gekoppeld</span>
                      )}
                      {canEdit && (
                        <>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {row.suggestions.map((s) => (
                              <button
                                key={s.rgsCode}
                                className={`text-xs font-mono px-1.5 py-0.5 rounded border ${
                                  row.mapping?.rgsCode === s.rgsCode
                                    ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                                    : "border-slate-200 hover:bg-slate-50 text-slate-600"
                                }`}
                                title={`${s.description} (${s.source === "history" ? "eerder gekoppeld" : "naam-match"})`}
                                onClick={() => apply(row, { rgsCode: s.rgsCode }, "SUGGESTED")}
                              >
                                {s.rgsCode}
                              </button>
                            ))}
                            {row.suggestions.length === 0 && (
                              <span className="text-xs text-slate-300">geen suggesties</span>
                            )}
                          </div>
                          <div className="mt-1">
                            <RgsCodeSearch
                              accountType={row.accountType}
                              onPick={(code) => apply(row, { rgsCode: code }, "MANUAL")}
                            />
                          </div>
                        </>
                      )}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <select
                        className="lf-input text-xs h-8 py-0"
                        value={row.mapping?.finCategoryId ?? ""}
                        disabled={!canEdit}
                        onChange={(e) => apply(row, { finCategoryId: e.target.value || null }, row.mapping?.confidence ?? "MANUAL")}
                      >
                        <option value="">—</option>
                        {cats?.categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-right">
                      <button className="lf-link text-xs" onClick={() => openHistory(row.code)}>
                        Historie
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function HistoryModal({ code, rows, onClose }: { code: string; rows: unknown[]; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-2 border-b border-slate-200">
          <div className="font-medium text-sm">
            Koppelingshistorie · <span className="font-mono">{code}</span>
          </div>
          <button className="lf-btn-secondary text-xs" onClick={onClose}>
            Sluiten
          </button>
        </div>
        <div className="overflow-auto p-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-1 pr-3 font-medium">RGS-code</th>
                <th className="py-1 pr-3 font-medium">FIN</th>
                <th className="py-1 pr-3 font-medium">Zekerheid</th>
                <th className="py-1 pr-3 font-medium">Aangemaakt</th>
                <th className="py-1 pr-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {(rows as Record<string, unknown>[]).map((h, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="py-1 pr-3 font-mono">{(h.rgsCode as string) ?? "—"}</td>
                  <td className="py-1 pr-3">{(h.finCategory as { key?: string })?.key ?? "—"}</td>
                  <td className="py-1 pr-3">{h.confidence as string}</td>
                  <td className="py-1 pr-3 text-slate-500">{String(h.createdAt).slice(0, 19).replace("T", " ")}</td>
                  <td className="py-1 pr-3">
                    {h.supersededAt ? <span className="text-slate-400">vervangen</span> : <span className="text-emerald-700">actief</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { formatMoney } from "../lib/period";
import { CacheBar } from "../components/CacheBar";

type ElimCategory = "EQUITY_INVESTMENT" | "CURRENT_ACCOUNT" | "LOAN";

interface ElimAccountRow {
  entityId: string;
  entityName: string;
  glAccountCode: string;
  glAccountName: string;
  rgsCode: string | null;
  category: ElimCategory;
  categoryLabel: string;
  balance: number;
  autoEliminate: boolean;
  autoCounterpartyId: string | null;
  overrideEliminate: boolean | null;
  overrideCounterpartyId: string | null;
  effectiveEliminate: boolean;
  effectiveCounterpartyId: string | null;
  source: "manual" | "auto";
}
interface ElimAccountsResult {
  entities: { id: string; name: string }[];
  rows: ElimAccountRow[];
  cachedAt: string | null;
  warnings: string[];
}

/**
 * Elimination rules at GL-account level. Per administration it lists every
 * deelneming/RC/lening account detected, the automatic decision (eliminate +
 * counterparty), and lets the user override: automatic, do-not-eliminate, or
 * eliminate against a chosen administration. Drives both the reconciliation
 * report and the consolidation elimination engine.
 */
export function EliminationMappingPage() {
  const { workspace, group, entity, dateFrom, dateTo, currency } = useScope();
  const qc = useQueryClient();
  const [onlyEliminated, setOnlyEliminated] = useState(false);

  const forceRef = useRef(false);
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["elim-accounts", workspace?.id, group?.id, entity?.id, dateFrom, dateTo, currency],
    queryFn: () => {
      const f = forceRef.current;
      forceRef.current = false;
      return api<ElimAccountsResult>(
        `/api/consolidation/elimination-accounts?from=${dateFrom}&to=${dateTo}&currency=${currency}${f ? "&refresh=1" : ""}`,
      );
    },
    enabled: !!workspace,
  });
  const refresh = () => {
    forceRef.current = true;
    refetch();
  };

  const setMutation = useMutation({
    mutationFn: (b: {
      entityId: string;
      glAccountCode: string;
      glAccountName: string | null;
      eliminate: boolean | null;
      counterpartyEntityId: string | null;
      category: string | null;
    }) => api("/api/consolidation/elimination-mappings", { method: "POST", body: b }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["elim-accounts"] });
      qc.invalidateQueries({ queryKey: ["ic-reconciliation"] });
      qc.invalidateQueries({ queryKey: ["consolidation"] });
      qc.invalidateQueries({ queryKey: ["dashboard-kpis"] });
    },
  });

  const nameOf = (id: string | null) => data?.entities.find((e) => e.id === id)?.name ?? null;
  const scopeLabel = group ? `Groep: ${group.name}` : `Werkruimte: ${workspace?.name ?? "—"}`;

  // Selected value for a row's control.
  const valueFor = (r: ElimAccountRow): string => {
    if (r.source === "auto") return "auto";
    if (!r.effectiveEliminate) return "none";
    return r.effectiveCounterpartyId ?? "auto";
  };
  const onChange = (r: ElimAccountRow, v: string) => {
    const base = { entityId: r.entityId, glAccountCode: r.glAccountCode, glAccountName: r.glAccountName, category: r.category };
    if (v === "auto") setMutation.mutate({ ...base, eliminate: null, counterpartyEntityId: null });
    else if (v === "none") setMutation.mutate({ ...base, eliminate: false, counterpartyEntityId: null });
    else setMutation.mutate({ ...base, eliminate: true, counterpartyEntityId: v });
  };
  const autoLabel = (r: ElimAccountRow) =>
    r.autoEliminate ? `elimineren tegen ${nameOf(r.autoCounterpartyId) ?? "—"}` : "niet elimineren (buiten consolidatie)";

  // Group rows per administration.
  const byEntity = new Map<string, ElimAccountRow[]>();
  for (const r of data?.rows ?? []) {
    if (onlyEliminated && !r.effectiveEliminate) continue;
    const arr = byEntity.get(r.entityId) ?? [];
    arr.push(r);
    byEntity.set(r.entityId, arr);
  }
  const elimCount = (data?.rows ?? []).filter((r) => r.effectiveEliminate).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Eliminatieregels</h1>
          <p className="text-sm text-slate-500 mt-1">
            {scopeLabel} · {dateFrom} t/m {dateTo} · {currency} · per grootboekrekening bepalen óf en tegen welke
            administratie wordt geëlimineerd. Een deelneming in een onderneming buiten de consolidatie wordt automatisch
            niet geëlimineerd.
          </p>
          {workspace && (
            <div className="mt-1">
              <CacheBar cachedAt={data?.cachedAt} refreshing={isFetching} onRefresh={refresh} />
            </div>
          )}
        </div>
      </div>

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte in de bovenbalk.</div>}
      {workspace && isLoading && <div className="lf-card">Rekeningen laden… (proefbalansen worden opgehaald)</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">{error instanceof ApiError ? error.message : "Kon rekeningen niet laden"}</div>
      )}

      {data && (
        <div className="flex items-center gap-4 flex-wrap text-sm">
          <span className="text-xs text-slate-500">
            {elimCount} van {data.rows.length} rekening(en) worden geëlimineerd.
          </span>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={onlyEliminated} onChange={(e) => setOnlyEliminated(e.target.checked)} />
            Alleen geëlimineerde rekeningen tonen
          </label>
        </div>
      )}

      {data && data.warnings.length > 0 && (
        <div className="lf-card bg-amber-50 ring-amber-200 text-amber-900 text-sm space-y-1">
          {data.warnings.map((w, i) => (
            <div key={i}>⚠️ {w}</div>
          ))}
        </div>
      )}

      {data && data.rows.length === 0 && !isLoading && (
        <div className="lf-card text-sm text-slate-500">
          Geen deelneming-, rekening-courant- of leningrekeningen gevonden in deze scope.
        </div>
      )}

      {data &&
        [...byEntity.entries()].map(([entId, rows]) => {
          const options = data.entities.filter((e) => e.id !== entId);
          return (
            <div key={entId} className="lf-card">
              <h2 className="text-lg font-semibold mb-2">{rows[0]?.entityName}</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-slate-200 text-slate-500">
                    <th className="py-1.5 pr-4">Rekening</th>
                    <th className="py-1.5 pr-4">Omschrijving</th>
                    <th className="py-1.5 pr-4">Type</th>
                    <th className="py-1.5 pr-4 text-right">Saldo</th>
                    <th className="py-1.5 pr-4">Eliminatie</th>
                    <th className="py-1.5 pr-4">Resultaat</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.glAccountCode} className="border-b border-slate-50">
                      <td className="py-1.5 pr-4 font-mono text-xs text-slate-500">{r.glAccountCode}</td>
                      <td className="py-1.5 pr-4">{r.glAccountName}</td>
                      <td className="py-1.5 pr-4 text-xs text-slate-500">{r.categoryLabel}</td>
                      <td className="py-1.5 pr-4 text-right whitespace-nowrap">{formatMoney(r.balance, currency)}</td>
                      <td className="py-1.5 pr-4">
                        <select
                          className="lf-input text-xs h-8 py-0 w-64"
                          value={valueFor(r)}
                          disabled={setMutation.isPending}
                          onChange={(e) => onChange(r, e.target.value)}
                        >
                          <option value="auto">Automatisch ({autoLabel(r)})</option>
                          <option value="none">Niet elimineren</option>
                          {options.map((e) => (
                            <option key={e.id} value={e.id}>
                              Elimineren tegen {e.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-4">
                        {r.effectiveEliminate ? (
                          <span className="px-2 py-0.5 rounded-full text-xs ring-1 bg-emerald-50 text-emerald-700 ring-emerald-200">
                            ↔ {nameOf(r.effectiveCounterpartyId) ?? "tegenpartij"}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs ring-1 bg-slate-50 text-slate-500 ring-slate-200">
                            Niet geëlimineerd
                          </span>
                        )}
                        {r.source === "manual" && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600">handmatig</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
    </div>
  );
}

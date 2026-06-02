import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useScope } from "../contexts/ScopeContext";
import { api } from "../services/api";
import { formatMoney } from "../lib/period";
import { CacheBar } from "../components/CacheBar";
import { ErrorNotice } from "../components/ErrorNotice";

interface TbLine {
  glAccountCode: string;
  glAccountName: string;
  accountType: "BALANCE" | "PROFIT_LOSS";
  balance: number;
  currency: string;
  rgsCode?: string | null;
  rgsGroupCode?: string | null;
  rgsGroupName?: string | null;
  finCategory?: string | null;
}

/**
 * Raw data explorer: the connector's source accounts (raw GL code/name/balance)
 * shown side-by-side with the normalized RGS output, so you can see exactly how
 * each brongegeven is mapped — and which accounts aren't mapped yet.
 */
export function RawExplorerPage() {
  const { workspace, entity, dateFrom, dateTo, currency } = useScope();
  const [q, setQ] = useState("");
  const [onlyUnmapped, setOnlyUnmapped] = useState(false);

  const forceRef = useRef(false);
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["raw-explorer", entity?.id, dateFrom, dateTo, currency],
    queryFn: () => {
      const f = forceRef.current;
      forceRef.current = false;
      return api<{ rows: TbLine[]; cachedAt?: string | null }>(
        `/api/ledger/trial-balance?from=${dateFrom}&to=${dateTo}&currency=${currency}${f ? "&refresh=1" : ""}`,
      );
    },
    enabled: !!entity,
  });
  const refresh = () => { forceRef.current = true; refetch(); };

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.rows ?? []).filter((l) => {
      if (onlyUnmapped && l.rgsCode) return false;
      if (term && !(`${l.glAccountCode} ${l.glAccountName} ${l.rgsCode ?? ""} ${l.rgsGroupName ?? ""}`.toLowerCase().includes(term))) return false;
      return true;
    });
  }, [data, q, onlyUnmapped]);
  const total = data?.rows.length ?? 0;
  const mapped = data?.rows.filter((l) => l.rgsCode).length ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Ruwe data</h1>
        <p className="text-sm text-slate-500 mt-1">
          {entity ? entity.name : "Selecteer een administratie"} · brongegevens naast de genormaliseerde RGS-laag
        </p>
        {entity && <div className="mt-1"><CacheBar cachedAt={data?.cachedAt} refreshing={isFetching} onRefresh={refresh} /></div>}
      </div>

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte in de bovenbalk.</div>}
      {workspace && !entity && <div className="lf-card max-w-2xl">Selecteer een administratie om de brondata te bekijken.</div>}
      {entity && isLoading && <div className="lf-card">Brondata laden…</div>}
      {isError && <ErrorNotice error={error} fallback="Kon brondata niet laden" onRetry={refresh} />}

      {data && (
        <div className="flex items-center gap-4 flex-wrap text-sm">
          <input className="lf-input h-9 text-sm w-72" placeholder="Zoek op code, naam of RGS…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={onlyUnmapped} onChange={(e) => setOnlyUnmapped(e.target.checked)} />
            Alleen niet-gekoppeld
          </label>
          <span className="text-xs text-slate-500">{mapped}/{total} gekoppeld · {rows.length} getoond</span>
        </div>
      )}

      {data && (
        <div className="lf-card p-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-2 px-3 font-medium" colSpan={3}>Brongegevens (connector)</th>
                <th className="py-2 px-3 font-medium border-l border-slate-200" colSpan={3}>Genormaliseerd (RGS)</th>
              </tr>
              <tr className="border-b border-slate-200 text-xs">
                <th className="py-1.5 px-3 font-medium">Code</th>
                <th className="py-1.5 px-3 font-medium">Grootboekrekening</th>
                <th className="py-1.5 px-3 font-medium text-right">Saldo</th>
                <th className="py-1.5 px-3 font-medium border-l border-slate-200">RGS-code</th>
                <th className="py-1.5 px-3 font-medium">RGS-rubriek</th>
                <th className="py-1.5 px-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.glAccountCode} className="border-b border-slate-50">
                  <td className="py-1.5 px-3 font-mono text-xs text-slate-500">{l.glAccountCode}</td>
                  <td className="py-1.5 px-3">{l.glAccountName}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums whitespace-nowrap">{formatMoney(l.balance, l.currency || currency)}</td>
                  <td className="py-1.5 px-3 font-mono text-xs text-slate-500 border-l border-slate-100">{l.rgsCode ?? "—"}</td>
                  <td className="py-1.5 px-3 text-slate-600">{l.rgsGroupName ?? "—"}</td>
                  <td className="py-1.5 px-3">
                    {l.rgsCode ? (
                      <span className="px-2 py-0.5 rounded-full text-xs ring-1 bg-emerald-50 text-emerald-700 ring-emerald-200">gekoppeld</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs ring-1 bg-amber-50 text-amber-800 ring-amber-200">niet gekoppeld</span>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={6} className="py-4 px-3 text-center text-slate-400">Geen rekeningen die aan het filter voldoen.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data && onlyUnmapped && rows.length > 0 && (
        <div className="text-sm text-slate-500">
          Koppel niet-gekoppelde rekeningen via <Link to="/mappings/rgs" className="lf-link">Rekeningkoppelingen (RGS)</Link>.
        </div>
      )}
    </div>
  );
}

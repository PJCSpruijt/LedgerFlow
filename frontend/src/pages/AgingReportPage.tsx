import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api } from "../services/api";
import { formatMoney } from "../lib/period";
import { CacheBar } from "../components/CacheBar";
import { ErrorNotice } from "../components/ErrorNotice";
import { ExportButtons } from "../components/ExportButtons";

type Bucket = "current" | "d30" | "d60" | "d90" | "d90p";
const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "current", label: "Niet vervallen" },
  { key: "d30", label: "1–30" },
  { key: "d60", label: "31–60" },
  { key: "d90", label: "61–90" },
  { key: "d90p", label: "> 90" },
];
type Buckets = Record<Bucket, number>;
interface AgingRow {
  relationName: string;
  intercompany: boolean;
  total: number;
  buckets: Buckets;
  byEntity: { entityId: string; entityName: string; amount: number }[];
}
interface AgingSide {
  rows: AgingRow[];
  totals: Buckets;
  grandTotal: number;
  intercompanyTotal: number;
}
interface AgingResult {
  from: string;
  to: string;
  asOf: string;
  currency: string;
  entities: { id: string; name: string; included: boolean; reason?: string; rateLimited?: boolean }[];
  debtors: AgingSide;
  creditors: AgingSide;
  dso: number | null;
  dpo: number | null;
  revenue: number;
  cost: number;
  periodDays: number;
  cachedAt?: string | null;
  warnings: string[];
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="lf-card">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function AgingTable({ side, currency, excludeIc }: { side: AgingSide; currency: string; excludeIc: boolean }) {
  const rows = excludeIc ? side.rows.filter((r) => !r.intercompany) : side.rows;
  const totals: Buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
  let grand = 0;
  for (const r of rows) {
    for (const b of BUCKETS) totals[b.key] += r.buckets[b.key];
    grand += r.total;
  }
  if (rows.length === 0) return <p className="text-sm text-slate-400">Geen openstaande posten.</p>;
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left border-b border-slate-200 text-slate-500">
          <th className="py-1.5 pr-4">Relatie</th>
          {BUCKETS.map((b) => (
            <th key={b.key} className="py-1.5 pr-4 text-right">{b.label}</th>
          ))}
          <th className="py-1.5 pr-4 text-right">Totaal</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.relationName} className="border-b border-slate-50">
            <td className="py-1.5 pr-4">
              {r.relationName}
              {r.intercompany && <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] bg-violet-50 text-violet-700 ring-1 ring-violet-200">IC</span>}
            </td>
            {BUCKETS.map((b) => (
              <td key={b.key} className={`py-1.5 pr-4 text-right tabular-nums ${b.key === "d90p" && r.buckets.d90p > 0 ? "text-rose-600" : "text-slate-600"}`}>
                {r.buckets[b.key] ? formatMoney(r.buckets[b.key], currency) : ""}
              </td>
            ))}
            <td className="py-1.5 pr-4 text-right tabular-nums font-medium">{formatMoney(r.total, currency)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-slate-300 font-semibold">
          <td className="py-1.5 pr-4">Totaal ({rows.length})</td>
          {BUCKETS.map((b) => (
            <td key={b.key} className="py-1.5 pr-4 text-right tabular-nums">{formatMoney(totals[b.key], currency)}</td>
          ))}
          <td className="py-1.5 pr-4 text-right tabular-nums">{formatMoney(grand, currency)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

/**
 * Receivables/payables aging report — consolidated across the scope, in the
 * reporting currency, bucketed by overdue age, with DSO/DPO. Intercompany
 * relations are flagged and can be excluded.
 */
export function AgingReportPage() {
  const { workspace, group, entity, dateFrom, dateTo, currency } = useScope();
  const [excludeIc, setExcludeIc] = useState(false);

  const forceRef = useRef(false);
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["aging", workspace?.id, group?.id, entity?.id, dateFrom, dateTo, currency],
    queryFn: () => {
      const f = forceRef.current;
      forceRef.current = false;
      return api<AgingResult>(`/api/reporting/aging?from=${dateFrom}&to=${dateTo}&currency=${currency}${f ? "&refresh=1" : ""}`);
    },
    enabled: !!workspace,
  });
  const refresh = () => {
    forceRef.current = true;
    refetch();
  };
  const scopeLabel = group ? `Groep: ${group.name}` : `Werkruimte: ${workspace?.name ?? "—"}`;

  const exportRows = (side: AgingSide) =>
    (excludeIc ? side.rows.filter((r) => !r.intercompany) : side.rows).map((r) => ({
      relatie: r.relationName,
      intercompany: r.intercompany ? "ja" : "nee",
      niet_vervallen: r.buckets.current,
      d1_30: r.buckets.d30,
      d31_60: r.buckets.d60,
      d61_90: r.buckets.d90,
      meer_dan_90: r.buckets.d90p,
      totaal: r.total,
    }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Ouderdomsanalyse</h1>
          <p className="text-sm text-slate-500 mt-1">
            {scopeLabel} · per {dateTo} · {currency} · openstaande debiteuren & crediteuren naar ouderdom
          </p>
          {workspace && <div className="mt-1"><CacheBar cachedAt={data?.cachedAt} refreshing={isFetching} onRefresh={refresh} /></div>}
        </div>
        {data && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={excludeIc} onChange={(e) => setExcludeIc(e.target.checked)} />
            Intercompany uitsluiten
          </label>
        )}
      </div>

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte in de bovenbalk.</div>}
      {workspace && isLoading && <div className="lf-card">Ouderdomsanalyse laden…</div>}
      {isError && <ErrorNotice error={error} fallback="Kon ouderdomsanalyse niet laden" onRetry={refresh} />}

      {data && data.warnings.length > 0 && (
        <div className="lf-card bg-amber-50 ring-amber-200 text-amber-900 text-sm space-y-1">
          {data.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Tile label="Openstaand debiteuren" value={formatMoney(excludeIc ? data.debtors.grandTotal - data.debtors.intercompanyTotal : data.debtors.grandTotal, currency)} sub={data.debtors.intercompanyTotal ? `incl. ${formatMoney(data.debtors.intercompanyTotal, currency)} intercompany` : undefined} />
          <Tile label="Openstaand crediteuren" value={formatMoney(excludeIc ? data.creditors.grandTotal - data.creditors.intercompanyTotal : data.creditors.grandTotal, currency)} />
          <Tile label="DSO (debiteurendagen)" value={data.dso != null ? `${data.dso} dgn` : "—"} sub={`omzet ${formatMoney(data.revenue, currency)} · ${data.periodDays}d`} />
          <Tile label="DPO (crediteurendagen)" value={data.dpo != null ? `${data.dpo} dgn` : "—"} sub={`kosten ${formatMoney(data.cost, currency)} · ${data.periodDays}d`} />
        </div>
      )}

      {data && (
        <div className="lf-card">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Debiteuren</h2>
            <ExportButtons filename={`debiteuren-ouderdom-${dateTo}`} sheetName="Debiteuren" getRows={() => exportRows(data.debtors)} />
          </div>
          <AgingTable side={data.debtors} currency={currency} excludeIc={excludeIc} />
        </div>
      )}

      {data && (
        <div className="lf-card">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold">Crediteuren</h2>
            <ExportButtons filename={`crediteuren-ouderdom-${dateTo}`} sheetName="Crediteuren" getRows={() => exportRows(data.creditors)} />
          </div>
          <AgingTable side={data.creditors} currency={currency} excludeIc={excludeIc} />
        </div>
      )}
    </div>
  );
}

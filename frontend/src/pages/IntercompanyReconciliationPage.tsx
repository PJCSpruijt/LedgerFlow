import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { formatMoney } from "../lib/period";
import { ExportButtons } from "../components/ExportButtons";
import { CacheBar } from "../components/CacheBar";

type Category = "EQUITY_INVESTMENT" | "CURRENT_ACCOUNT" | "LOAN" | "RECEIVABLE_PAYABLE" | "REVENUE_COST";
interface PairResult {
  category: Category;
  categoryLabel: string;
  aEntityName: string;
  bEntityName: string;
  aAmount: number;
  bAmount: number;
  residual: number;
  status: "MATCHED" | "ONE_SIDED" | "MISMATCH";
  warning: string;
}
interface ReconRow {
  category: Category;
  categoryLabel: string;
  entityName: string;
  accountCode: string;
  accountName: string;
  rgsCode: string | null;
  counterpartyName: string | null;
  amount: number;
}
interface ReconResult {
  from: string;
  to: string;
  currency: string;
  tolerance: number;
  entities: { id: string; name: string; included: boolean; reason?: string }[];
  pairs: PairResult[];
  rows: ReconRow[];
  summary: { matched: number; oneSided: number; mismatched: number };
  cachedAt?: string | null;
  warnings: string[];
}

const CATEGORY_ORDER: Category[] = ["EQUITY_INVESTMENT", "CURRENT_ACCOUNT", "LOAN", "RECEIVABLE_PAYABLE", "REVENUE_COST"];

function StatusBadge({ status }: { status: PairResult["status"] }) {
  const map = {
    MATCHED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    ONE_SIDED: "bg-amber-50 text-amber-800 ring-amber-200",
    MISMATCH: "bg-rose-50 text-rose-700 ring-rose-200",
  } as const;
  const label = status === "MATCHED" ? "Sluit" : status === "ONE_SIDED" ? "Eenzijdig" : "Verschil";
  return <span className={`px-2 py-0.5 rounded-full text-xs ring-1 ${map[status]}`}>{label}</span>;
}

/**
 * Intercompany reconciliation: per counterparty pair and elimination category,
 * the two legs and a typed mismatch warning — the digital version of the manual
 * reconciliation worksheet ("Waarschuwing"-kolom).
 */
export function IntercompanyReconciliationPage() {
  const { workspace, group, entity, dateFrom, dateTo, currency } = useScope();

  const forceRef = useRef(false);
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["ic-reconciliation", workspace?.id, group?.id, entity?.id, dateFrom, dateTo, currency],
    queryFn: () => {
      const f = forceRef.current;
      forceRef.current = false;
      return api<ReconResult>(`/api/consolidation/reconciliation?from=${dateFrom}&to=${dateTo}&currency=${currency}${f ? "&refresh=1" : ""}`);
    },
    enabled: !!workspace,
  });
  const refresh = () => {
    forceRef.current = true;
    refetch();
  };

  const scopeLabel = group ? `Groep: ${group.name}` : `Werkruimte: ${workspace?.name ?? "—"}`;
  const cats = CATEGORY_ORDER.filter((c) => data?.pairs.some((p) => p.category === c) || data?.rows.some((r) => r.category === c));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Intercompany-reconciliatie</h1>
          <p className="text-sm text-slate-500 mt-1">
            {scopeLabel} · {dateFrom} t/m {dateTo} · {currency} · per type gesignaleerd of de onderlinge posten sluiten
          </p>
          {workspace && <div className="mt-1"><CacheBar cachedAt={data?.cachedAt} refreshing={isFetching} onRefresh={refresh} /></div>}
        </div>
        {data && (
          <ExportButtons
            filename={`ic-reconciliatie-${dateFrom}_${dateTo}`}
            sheetName="Reconciliatie"
            getRows={() =>
              data.rows.map((r) => ({
                categorie: r.categoryLabel,
                administratie: r.entityName,
                rekening: r.accountCode,
                omschrijving: r.accountName,
                rgs: r.rgsCode ?? "",
                tegenpartij: r.counterpartyName ?? "",
                bedrag: r.amount,
              }))
            }
          />
        )}
      </div>

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte in de bovenbalk.</div>}
      {workspace && isLoading && <div className="lf-card">Reconciliatie laden… (administraties worden opgehaald)</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">{error instanceof ApiError ? error.message : "Kon reconciliatie niet laden"}</div>
      )}

      {data && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="lf-card px-3 py-1.5">✅ {data.summary.matched} sluitend</span>
          <span className="lf-card px-3 py-1.5">🟠 {data.summary.oneSided} eenzijdig</span>
          <span className="lf-card px-3 py-1.5">🔴 {data.summary.mismatched} verschil</span>
        </div>
      )}

      {data && data.warnings.length > 0 && (
        <div className="lf-card bg-amber-50 ring-amber-200 text-amber-900 text-sm space-y-1">
          {data.warnings.map((w, i) => (
            <div key={i}>⚠️ {w}</div>
          ))}
        </div>
      )}

      {data && data.pairs.length === 0 && !isLoading && (
        <div className="lf-card text-sm text-slate-500">
          Geen intercompany-posten gevonden. Koppel relaties via Intercompany-matching en zorg dat beide administraties
          RGS-gekoppeld zijn.
        </div>
      )}

      {data &&
        cats.map((cat) => {
          const pairs = data.pairs.filter((p) => p.category === cat);
          const rows = data.rows.filter((r) => r.category === cat);
          const label = pairs[0]?.categoryLabel ?? rows[0]?.categoryLabel ?? cat;
          return (
            <div key={cat} className="lf-card">
              <h2 className="text-lg font-semibold mb-2">{label}</h2>

              {/* Per-pair reconciliation + typed warning */}
              <table className="w-full text-sm mb-3">
                <thead>
                  <tr className="text-left border-b border-slate-200 text-slate-500">
                    <th className="py-1.5 pr-4">Administratie A</th>
                    <th className="py-1.5 pr-4 text-right">Bedrag A</th>
                    <th className="py-1.5 pr-4">Administratie B</th>
                    <th className="py-1.5 pr-4 text-right">Bedrag B</th>
                    <th className="py-1.5 pr-4 text-right">Verschil</th>
                    <th className="py-1.5 pr-4">Status</th>
                    <th className="py-1.5 pr-4">Waarschuwing</th>
                  </tr>
                </thead>
                <tbody>
                  {pairs.map((p, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-1.5 pr-4">{p.aEntityName}</td>
                      <td className="py-1.5 pr-4 text-right whitespace-nowrap">{formatMoney(p.aAmount, currency)}</td>
                      <td className="py-1.5 pr-4">{p.bEntityName}</td>
                      <td className="py-1.5 pr-4 text-right whitespace-nowrap">{formatMoney(p.bAmount, currency)}</td>
                      <td className={`py-1.5 pr-4 text-right whitespace-nowrap ${p.status === "MISMATCH" ? "text-rose-700 font-medium" : p.status === "ONE_SIDED" ? "text-amber-700" : "text-slate-500"}`}>
                        {formatMoney(p.residual, currency)}
                      </td>
                      <td className="py-1.5 pr-4"><StatusBadge status={p.status} /></td>
                      <td className={`py-1.5 pr-4 text-xs ${p.status === "MATCHED" ? "text-slate-400" : "text-rose-700"}`}>{p.warning}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Underlying account lines (the worksheet) */}
              {rows.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-xs text-slate-500">Onderliggende rekeningen ({rows.length})</summary>
                  <table className="w-full text-sm mt-2">
                    <thead>
                      <tr className="text-left border-b border-slate-200 text-slate-500">
                        <th className="py-1 pr-4">Adm.</th>
                        <th className="py-1 pr-4">Rekening</th>
                        <th className="py-1 pr-4">Omschrijving</th>
                        <th className="py-1 pr-4">Tegenpartij</th>
                        <th className="py-1 pr-4 text-right">Bedrag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-b border-slate-50">
                          <td className="py-1 pr-4 whitespace-nowrap">{r.entityName}</td>
                          <td className="py-1 pr-4 font-mono text-xs text-slate-500">{r.accountCode}</td>
                          <td className="py-1 pr-4">{r.accountName}</td>
                          <td className="py-1 pr-4 text-slate-500">{r.counterpartyName ?? "—"}</td>
                          <td className="py-1 pr-4 text-right whitespace-nowrap">{formatMoney(r.amount, currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
            </div>
          );
        })}
    </div>
  );
}

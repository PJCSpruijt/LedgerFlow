import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useScope } from "../contexts/ScopeContext";
import { api } from "../services/api";
import { formatMoney } from "../lib/period";
import { ExportButtons } from "../components/ExportButtons";
import { ErrorNotice } from "../components/ErrorNotice";

interface TbLine {
  glAccountCode: string;
  glAccountName: string;
  accountType: "BALANCE" | "PROFIT_LOSS" | "UNKNOWN";
  debit: number;
  credit: number;
  balance: number;
  currency: string;
}

type SortKey = "glAccountCode" | "glAccountName" | "accountType" | "debit" | "credit" | "balance";
type SortDir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "glAccountCode", label: "Code" },
  { key: "glAccountName", label: "Grootboekrekening" },
  { key: "accountType", label: "Type" },
  { key: "debit", label: "Debet", align: "right" },
  { key: "credit", label: "Credit", align: "right" },
  { key: "balance", label: "Saldo", align: "right" },
];

const typeLabel = (t: TbLine["accountType"]) =>
  t === "BALANCE" ? "Balans" : t === "PROFIT_LOSS" ? "Resultaat" : "Overig";

function compareBy(key: SortKey, a: TbLine, b: TbLine): number {
  if (key === "debit" || key === "credit" || key === "balance") return a[key] - b[key];
  if (key === "accountType") return typeLabel(a.accountType).localeCompare(typeLabel(b.accountType));
  return String(a[key]).localeCompare(String(b[key]), undefined, { numeric: true });
}

export function GeneralLedgerPage() {
  const { entity, dateFrom, dateTo, currency } = useScope();
  const navigate = useNavigate();
  const range = { from: dateFrom, to: dateTo };

  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  const [groupByType, setGroupByType] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({ codeFrom: "", codeTo: "", name: "", type: "" });
  const filterActive = !!(filters.codeFrom || filters.codeTo || filters.name || filters.type);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["trial-balance", entity?.id, range.from, range.to],
    queryFn: () => api<{ rows: TbLine[] }>(`/api/yuki/trial-balance?from=${range.from}&to=${range.to}`),
    enabled: !!entity,
  });

  // Header click cycles: asc → desc → off.
  const onSort = (key: SortKey) =>
    setSort((prev) =>
      !prev || prev.key !== key
        ? { key, dir: "asc" }
        : prev.dir === "asc"
          ? { key, dir: "desc" }
          : null,
    );

  const rows = useMemo(() => {
    let r = (data?.rows ?? []).filter((x) => {
      const code = x.glAccountCode || "";
      const lo = filters.codeFrom.trim();
      const hi = filters.codeTo.trim();
      if (lo && hi) {
        if (!(code >= lo && code <= hi)) return false;
      } else if (lo) {
        if (!code.startsWith(lo) && !code.includes(lo)) return false;
      } else if (hi && !(code <= hi)) return false;
      if (filters.name.trim() && !x.glAccountName.toLowerCase().includes(filters.name.trim().toLowerCase()))
        return false;
      if (filters.type && x.accountType !== filters.type) return false;
      return true;
    });
    if (sort) {
      r = r.slice().sort((a, b) => {
        const c = compareBy(sort.key, a, b);
        return sort.dir === "asc" ? c : -c;
      });
    }
    return r;
  }, [data, filters, sort]);

  const totals = rows.reduce(
    (acc, r) => ({ debit: acc.debit + r.debit, credit: acc.credit + r.credit }),
    { debit: 0, credit: 0 },
  );

  // Group rows by type when requested (order: Balans, Resultaat, Overig).
  const groups = useMemo(() => {
    if (!groupByType) return null;
    const order = ["BALANCE", "PROFIT_LOSS", "UNKNOWN"] as const;
    return order
      .map((t) => {
        const lines = rows.filter((r) => r.accountType === t);
        return {
          type: t,
          lines,
          debit: lines.reduce((s, r) => s + r.debit, 0),
          credit: lines.reduce((s, r) => s + r.credit, 0),
        };
      })
      .filter((g) => g.lines.length > 0);
  }, [rows, groupByType]);

  const Row = ({ r }: { r: TbLine }) => (
    <tr
      className="border-b border-slate-100 cursor-pointer hover:bg-slate-50"
      title="Bekijk transacties van deze grootboekrekening"
      onClick={() => navigate(`/data/transactions?code=${encodeURIComponent(r.glAccountCode)}`)}
    >
      <td className="py-1.5 pr-4 pl-3 font-mono">{r.glAccountCode}</td>
      <td className="py-1.5 pr-4">{r.glAccountName}</td>
      <td className="py-1.5 pr-4 text-slate-600">{typeLabel(r.accountType)}</td>
      <td className="py-1.5 pr-4 text-right">{r.debit ? formatMoney(r.debit, currency) : ""}</td>
      <td className="py-1.5 pr-4 text-right">{r.credit ? formatMoney(r.credit, currency) : ""}</td>
      <td className="py-1.5 pr-4 text-right">{formatMoney(r.balance, currency)}</td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Grootboek / Proefbalans</h1>
          <p className="text-sm text-slate-500 mt-1">
            {entity ? `${entity.name} · ${range.from} t/m ${range.to}` : "Selecteer een administratie"}
          </p>
        </div>
        {data && (
          <div className="flex gap-3 text-xs items-center">
            <button
              className={`lf-link ${filterActive ? "font-semibold" : ""}`}
              onClick={() => setShowFilters((v) => !v)}
            >
              Filters{filterActive ? " ●" : ""} {showFilters ? "▴" : "▾"}
            </button>
            <button
              className={`lf-link ${groupByType ? "font-semibold" : ""}`}
              onClick={() => setGroupByType((v) => !v)}
            >
              {groupByType ? "Groepering uit" : "Groeperen op type"}
            </button>
            <ExportButtons
              filename={`grootboek-${range.from}_${range.to}`}
              sheetName="Grootboek"
              getRows={() =>
                rows.map((r) => ({
                  code: r.glAccountCode,
                  grootboekrekening: r.glAccountName,
                  type: typeLabel(r.accountType),
                  debet: r.debit,
                  credit: r.credit,
                  saldo: r.balance,
                  valuta: r.currency,
                }))
              }
            />
          </div>
        )}
      </div>

      {data && showFilters && (
        <div className="lf-card flex flex-wrap items-end gap-3 text-sm">
          <div>
            <label className="lf-label">Code van</label>
            <input
              className="lf-input font-mono w-24"
              value={filters.codeFrom}
              onChange={(e) => setFilters({ ...filters, codeFrom: e.target.value })}
            />
          </div>
          <div>
            <label className="lf-label">tot</label>
            <input
              className="lf-input font-mono w-24"
              value={filters.codeTo}
              onChange={(e) => setFilters({ ...filters, codeTo: e.target.value })}
            />
          </div>
          <div>
            <label className="lf-label">Grootboekrekening</label>
            <input
              className="lf-input w-44"
              placeholder="naam bevat…"
              value={filters.name}
              onChange={(e) => setFilters({ ...filters, name: e.target.value })}
            />
          </div>
          <div>
            <label className="lf-label">Type</label>
            <select
              className="lf-input"
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            >
              <option value="">Alle</option>
              <option value="BALANCE">Balans</option>
              <option value="PROFIT_LOSS">Resultaat</option>
              <option value="UNKNOWN">Overig</option>
            </select>
          </div>
          {filterActive && (
            <button
              className="lf-link"
              onClick={() => setFilters({ codeFrom: "", codeTo: "", name: "", type: "" })}
            >
              Wissen
            </button>
          )}
        </div>
      )}

      {!entity && <div className="lf-card max-w-2xl">Selecteer een administratie in de bovenbalk.</div>}
      {entity && isLoading && <div className="lf-card">Proefbalans laden…</div>}
      {isError && <ErrorNotice error={error} fallback="Kon proefbalans niet laden" onRetry={() => refetch()} />}

      {entity && data && (
        <div className="lf-card p-0">
          <div className="overflow-auto max-h-[calc(100vh-240px)]">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  {COLUMNS.map((col) => (
                    <th
                      key={col.key}
                      className={`py-2 px-3 font-medium whitespace-nowrap cursor-pointer select-none hover:text-slate-700 ${
                        col.align === "right" ? "text-right" : ""
                      }`}
                      onClick={() => onSort(col.key)}
                      title="Klik om te sorteren"
                    >
                      {col.label}
                      {sort?.key === col.key && (
                        <span className="ml-1 text-slate-400">{sort.dir === "asc" ? "▲" : "▼"}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!groups &&
                  rows.map((r, i) => <Row key={i} r={r} />)}
                {groups &&
                  groups.map((g) => (
                    <Fragment key={g.type}>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        <td className="py-2 px-3 font-semibold" colSpan={3}>
                          {typeLabel(g.type)} <span className="text-xs text-slate-400">({g.lines.length})</span>
                        </td>
                        <td className="py-2 pr-4 text-right font-semibold">{formatMoney(g.debit, currency)}</td>
                        <td className="py-2 pr-4 text-right font-semibold">{formatMoney(g.credit, currency)}</td>
                        <td className="py-2 pr-4 text-right font-semibold">
                          {formatMoney(g.debit - g.credit, currency)}
                        </td>
                      </tr>
                      {g.lines.map((r, i) => (
                        <Row key={i} r={r} />
                      ))}
                    </Fragment>
                  ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-3 px-3 text-slate-400">
                      Geen saldi in deze selectie.
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot className="sticky bottom-0 bg-white">
                  <tr className="border-t-2 border-slate-300 font-semibold">
                    <td className="py-2 px-3" colSpan={3}>
                      Totaal{filterActive ? " (selectie)" : ""}
                    </td>
                    <td className="py-2 pr-4 text-right">{formatMoney(totals.debit, currency)}</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(totals.credit, currency)}</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(totals.debit - totals.credit, currency)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

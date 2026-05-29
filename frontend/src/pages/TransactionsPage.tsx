import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { formatMoney } from "../lib/period";

interface Tx {
  date: string;
  glAccountCode: string;
  glAccountName: string;
  amount: number;
  contactName: string | null;
  reference: string | null;
  documentType: string | null;
  description: string;
  currency: string;
  generatedByConnector?: boolean;
  vatCode?: string | null;
  mappingConfidence?: "EXACT" | "INFERRED" | "REQUIRED";
}

interface Group {
  code: string;
  name: string;
  lines: Tx[];
  total: number;
}

function ConfidenceBadge({ c }: { c?: "EXACT" | "INFERRED" | "REQUIRED" }) {
  if (!c) return null;
  const map = {
    EXACT: "bg-emerald-100 text-emerald-800",
    INFERRED: "bg-blue-100 text-blue-800",
    REQUIRED: "bg-amber-100 text-amber-800",
  } as const;
  const label = { EXACT: "mapping", INFERRED: "afgeleid", REQUIRED: "mapping vereist" }[c];
  return <span className={`lf-pill ${map[c]}`}>{label}</span>;
}

export function TransactionsPage() {
  const { entity, dateFrom, dateTo, currency } = useScope();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["transactions", entity?.id, dateFrom, dateTo],
    queryFn: () => api<{ rows: Tx[] }>(`/api/yuki/transactions?from=${dateFrom}&to=${dateTo}`),
    enabled: !!entity,
  });

  const groups = useMemo<Group[]>(() => {
    const byCode = new Map<string, Group>();
    for (const t of data?.rows ?? []) {
      const code = t.glAccountCode || "—";
      const g = byCode.get(code) ?? { code, name: t.glAccountName || "(geen grootboekrekening)", lines: [], total: 0 };
      if (!g.name || g.name === "(geen grootboekrekening)") g.name = t.glAccountName || g.name;
      g.lines.push(t);
      g.total += t.amount;
      byCode.set(code, g);
    }
    return [...byCode.values()].sort((a, b) => (a.code === "—" ? 1 : b.code === "—" ? -1 : a.code.localeCompare(b.code)));
  }, [data]);

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });

  const totalLines = data?.rows.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Transacties</h1>
          <p className="text-sm text-slate-500 mt-1">
            {entity ? `${entity.name} · ${dateFrom} t/m ${dateTo}` : "Selecteer een administratie"}
          </p>
        </div>
        {data && (
          <div className="flex gap-2 text-xs">
            <button className="lf-link" onClick={() => setExpanded(new Set(groups.map((g) => g.code)))}>
              Alles uitklappen
            </button>
            <button className="lf-link" onClick={() => setExpanded(new Set())}>
              Alles inklappen
            </button>
          </div>
        )}
      </div>

      {!entity && <div className="lf-card max-w-2xl">Selecteer een administratie in de bovenbalk.</div>}
      {entity && isLoading && <div className="lf-card">Transacties laden…</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">
          {error instanceof ApiError ? error.message : "Kon transacties niet laden"}
        </div>
      )}

      {entity && data && (
        <div className="lf-card p-0">
          <div className="px-4 py-2 text-xs text-slate-500 border-b border-slate-100">
            {groups.length} grootboekrekeningen · {totalLines} regels
          </div>
          {/* Scroll within the frame; top + side menu stay fixed. Sticky header. */}
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 z-10 bg-slate-50">
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 px-3 font-medium whitespace-nowrap">Datum</th>
                  <th className="py-2 px-3 font-medium whitespace-nowrap text-right">Bedrag</th>
                  <th className="py-2 px-3 font-medium whitespace-nowrap">Relatie</th>
                  <th className="py-2 px-3 font-medium whitespace-nowrap">Referentie</th>
                  <th className="py-2 px-3 font-medium whitespace-nowrap">Documenttype</th>
                  <th className="py-2 px-3 font-medium whitespace-nowrap">Omschrijving</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const open = expanded.has(g.code);
                  return (
                    <GroupBlock key={g.code} g={g} open={open} onToggle={() => toggle(g.code)} currency={currency} />
                  );
                })}
                {groups.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-3 px-3 text-slate-400">
                      Geen transacties in deze periode.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function GroupBlock({
  g,
  open,
  onToggle,
  currency,
}: {
  g: Group;
  open: boolean;
  onToggle: () => void;
  currency: string;
}) {
  return (
    <>
      <tr className="bg-white border-b border-slate-200 cursor-pointer hover:bg-slate-50" onClick={onToggle}>
        <td colSpan={5} className="py-2 px-3 font-medium whitespace-nowrap">
          <span className="inline-block w-4 text-slate-400">{open ? "▾" : "▸"}</span>
          <span className="font-mono text-slate-500 mr-2">{g.code}</span>
          {g.name}
          <span className="ml-2 text-xs text-slate-400">({g.lines.length})</span>
        </td>
        <td className={`py-2 px-3 text-right font-semibold whitespace-nowrap ${g.total < 0 ? "text-red-600" : ""}`}>
          {formatMoney(g.total, currency)}
        </td>
      </tr>
      {open &&
        g.lines.map((t, i) => (
          <tr key={i} className="border-b border-slate-50 text-slate-700">
            <td className="py-1.5 px-3 pl-7 whitespace-nowrap">{t.date}</td>
            <td className={`py-1.5 px-3 text-right whitespace-nowrap ${t.amount < 0 ? "text-red-600" : ""}`}>
              {formatMoney(t.amount, t.currency || currency)}
            </td>
            <td className="py-1.5 px-3 whitespace-nowrap">{t.contactName ?? ""}</td>
            <td className="py-1.5 px-3 whitespace-nowrap">{t.reference ?? ""}</td>
            <td className="py-1.5 px-3 whitespace-nowrap">
              {t.documentType ?? ""}
              {t.generatedByConnector && (
                <span className="ml-2">
                  <ConfidenceBadge c={t.mappingConfidence} />
                </span>
              )}
            </td>
            <td className="py-1.5 px-3 whitespace-nowrap">{t.description}</td>
          </tr>
        ))}
    </>
  );
}

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { formatMoney } from "../lib/period";

interface TbLine {
  glAccountCode: string;
  glAccountName: string;
  accountType: "BALANCE" | "PROFIT_LOSS" | "UNKNOWN";
  debit: number;
  credit: number;
  balance: number;
  currency: string;
  rgsGroupCode?: string | null;
  rgsGroupName?: string | null;
}

interface CatGroup {
  code: string;
  name: string;
  lines: TbLine[];
  subtotal: number;
}

function AccountRow({ r, currency }: { r: TbLine; currency: string }) {
  const navigate = useNavigate();
  return (
    <tr
      className="border-b border-slate-50 cursor-pointer hover:bg-slate-50"
      title="Bekijk transacties van deze grootboekrekening"
      onClick={() => navigate(`/data/transactions?code=${encodeURIComponent(r.glAccountCode)}`)}
    >
      <td className="py-1.5 pr-4 pl-6 font-mono text-slate-500 w-24">{r.glAccountCode}</td>
      <td className="py-1.5 pr-4">{r.glAccountName}</td>
      <td className="py-1.5 pr-4 text-right whitespace-nowrap">{formatMoney(r.balance, currency)}</td>
    </tr>
  );
}

function Section({
  title,
  rows,
  currency,
  footer,
  grouped,
}: {
  title: string;
  rows: TbLine[];
  currency: string;
  footer: { label: string; value: number };
  grouped: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setOpen((p) => {
      const n = new Set(p);
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });

  const groups = useMemo<CatGroup[]>(() => {
    const byCode = new Map<string, CatGroup>();
    for (const r of rows) {
      const code = r.rgsGroupCode || "zzzz";
      const name = r.rgsGroupName || "Niet aan RGS gekoppeld";
      const g = byCode.get(code) ?? { code, name, lines: [], subtotal: 0 };
      g.lines.push(r);
      g.subtotal += r.balance;
      byCode.set(code, g);
    }
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [rows]);

  return (
    <div className="lf-card">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <table className="w-full text-sm">
        <tbody>
          {!grouped &&
            rows.map((r, i) => <AccountRow key={i} r={r} currency={currency} />)}

          {grouped &&
            groups.map((g) => {
              const isOpen = open.has(g.code);
              return (
                <Fragment key={g.code}>
                  <tr
                    className="border-b border-slate-200 bg-slate-50/70 cursor-pointer hover:bg-slate-100"
                    onClick={() => toggle(g.code)}
                  >
                    <td className="py-2 pr-4 pl-2 font-medium" colSpan={2}>
                      <span className="inline-block w-4 text-slate-400">{isOpen ? "▾" : "▸"}</span>
                      {g.name}
                      <span className="ml-2 text-xs text-slate-400">({g.lines.length})</span>
                    </td>
                    <td className="py-2 pr-4 text-right font-semibold whitespace-nowrap">
                      {formatMoney(g.subtotal, currency)}
                    </td>
                  </tr>
                  {isOpen &&
                    g.lines
                      .slice()
                      .sort((a, b) => a.glAccountCode.localeCompare(b.glAccountCode))
                      .map((r, i) => <AccountRow key={i} r={r} currency={currency} />)}
                </Fragment>
              );
            })}

          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="py-3 text-slate-400">
                Geen posten.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 font-semibold">
            <td className="py-2 pr-4" colSpan={2}>
              {footer.label}
            </td>
            <td className="py-2 pr-4 text-right">{formatMoney(footer.value, currency)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export function FinancialStatementsPage() {
  const { entity, dateFrom, dateTo, currency } = useScope();
  const range = { from: dateFrom, to: dateTo };

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["trial-balance", entity?.id, range.from, range.to],
    queryFn: () =>
      api<{ rows: TbLine[] }>(`/api/yuki/trial-balance?from=${range.from}&to=${range.to}`),
    enabled: !!entity,
  });

  const rows = data?.rows ?? [];
  const hasRgs = rows.some((r) => r.rgsGroupCode);
  const [grouped, setGrouped] = useState(true);
  const useGroups = hasRgs && grouped;

  const pnl = rows.filter((r) => r.accountType === "PROFIT_LOSS");
  const balance = rows.filter((r) => r.accountType !== "PROFIT_LOSS");
  const result = -pnl.reduce((s, r) => s + r.balance, 0);
  const balanceTotal = balance.reduce((s, r) => s + r.balance, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Jaarrekening</h1>
          <p className="text-sm text-slate-500 mt-1">
            {entity
              ? `${entity.name} · ${range.from} t/m ${range.to}`
              : "Selecteer een administratie"}
          </p>
        </div>
        {hasRgs && (
          <button className="lf-link text-xs" onClick={() => setGrouped((v) => !v)}>
            {grouped ? "Toon losse rekeningen" : "Groepeer op RGS-categorie"}
          </button>
        )}
      </div>

      {!entity && <div className="lf-card max-w-2xl">Selecteer een administratie in de bovenbalk.</div>}
      {entity && isLoading && <div className="lf-card">Jaarrekening laden…</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">
          {error instanceof ApiError ? error.message : "Kon jaarrekening niet laden"}
        </div>
      )}

      {entity && data && !hasRgs && (
        <div className="lf-card bg-blue-50 ring-blue-200 text-blue-900 text-sm">
          Tip: schakel RGS in (Instellingen → RGS / normalisatie) en koppel de rekeningen om de
          jaarrekening te groeperen op categorieën zoals Vorderingen, Eigen vermogen en
          Personeelskosten.
        </div>
      )}

      {entity && data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section
            title="Winst- en verliesrekening"
            rows={pnl}
            currency={currency}
            grouped={useGroups}
            footer={{ label: "Resultaat (winst +)", value: result }}
          />
          <Section
            title="Balans"
            rows={balance}
            currency={currency}
            grouped={useGroups}
            footer={{ label: "Saldo (debet − credit)", value: balanceTotal }}
          />
        </div>
      )}
    </div>
  );
}

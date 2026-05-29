import { useQuery } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { periodToRange, formatMoney } from "../lib/period";

interface TbLine {
  glAccountCode: string;
  glAccountName: string;
  accountType: "BALANCE" | "PROFIT_LOSS" | "UNKNOWN";
  debit: number;
  credit: number;
  balance: number;
  currency: string;
}

function Section({
  title,
  rows,
  currency,
  footer,
}: {
  title: string;
  rows: TbLine[];
  currency: string;
  footer: { label: string; value: number };
}) {
  return (
    <div className="lf-card">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100">
              <td className="py-1.5 pr-4 font-mono text-slate-500 w-20">{r.glAccountCode}</td>
              <td className="py-1.5 pr-4">{r.glAccountName}</td>
              <td className="py-1.5 pr-4 text-right whitespace-nowrap">
                {formatMoney(r.balance, currency)}
              </td>
            </tr>
          ))}
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
  const { entity, period, currency } = useScope();
  const range = periodToRange(period);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["trial-balance", entity?.id, range.from, range.to],
    queryFn: () =>
      api<{ rows: TbLine[] }>(`/api/yuki/trial-balance?from=${range.from}&to=${range.to}`),
    enabled: !!entity,
  });

  const rows = data?.rows ?? [];
  const pnl = rows.filter((r) => r.accountType === "PROFIT_LOSS");
  const balance = rows.filter((r) => r.accountType !== "PROFIT_LOSS");
  // P&L balance = debit - credit = costs - revenue; profit = -(sum).
  const result = -pnl.reduce((s, r) => s + r.balance, 0);
  const balanceTotal = balance.reduce((s, r) => s + r.balance, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Jaarrekening</h1>
        <p className="text-sm text-slate-500 mt-1">
          {entity ? `${entity.name} · ${range.from} t/m ${range.to}` : "Selecteer een administratie"}
        </p>
      </div>

      {!entity && <div className="lf-card max-w-2xl">Selecteer een administratie in de bovenbalk.</div>}
      {entity && isLoading && <div className="lf-card">Jaarrekening laden…</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">
          {error instanceof ApiError ? error.message : "Kon jaarrekening niet laden"}
        </div>
      )}

      {entity && data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Section
            title="Winst- en verliesrekening"
            rows={pnl}
            currency={currency}
            footer={{ label: "Resultaat (winst +)", value: result }}
          />
          <Section
            title="Balans"
            rows={balance}
            currency={currency}
            footer={{ label: "Saldo (debet − credit)", value: balanceTotal }}
          />
        </div>
      )}
    </div>
  );
}

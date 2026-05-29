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

export function GeneralLedgerPage() {
  const { entity, period, currency } = useScope();
  const range = periodToRange(period);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["trial-balance", entity?.id, range.from, range.to],
    queryFn: () => api<{ rows: TbLine[] }>(`/api/yuki/trial-balance?from=${range.from}&to=${range.to}`),
    enabled: !!entity,
  });

  const rows = data?.rows ?? [];
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Grootboek / Proefbalans</h1>
        <p className="text-sm text-slate-500 mt-1">
          {entity ? `${entity.name} · ${range.from} t/m ${range.to}` : "Selecteer een administratie"}
        </p>
      </div>

      {!entity && (
        <div className="lf-card max-w-2xl">Selecteer een administratie in de bovenbalk.</div>
      )}
      {entity && isLoading && <div className="lf-card">Proefbalans laden…</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">
          {error instanceof ApiError ? error.message : "Kon proefbalans niet laden"}
        </div>
      )}

      {entity && data && (
        <div className="lf-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-4 font-medium">Code</th>
                  <th className="py-2 pr-4 font-medium">Grootboekrekening</th>
                  <th className="py-2 pr-4 font-medium">Type</th>
                  <th className="py-2 pr-4 font-medium text-right">Debet</th>
                  <th className="py-2 pr-4 font-medium text-right">Credit</th>
                  <th className="py-2 pr-4 font-medium text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1.5 pr-4 font-mono">{r.glAccountCode}</td>
                    <td className="py-1.5 pr-4">{r.glAccountName}</td>
                    <td className="py-1.5 pr-4 text-slate-600">
                      {r.accountType === "BALANCE"
                        ? "Balans"
                        : r.accountType === "PROFIT_LOSS"
                          ? "Resultaat"
                          : "—"}
                    </td>
                    <td className="py-1.5 pr-4 text-right">{r.debit ? formatMoney(r.debit, currency) : ""}</td>
                    <td className="py-1.5 pr-4 text-right">{r.credit ? formatMoney(r.credit, currency) : ""}</td>
                    <td className="py-1.5 pr-4 text-right">{formatMoney(r.balance, currency)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-3 text-slate-400">
                      Geen saldi in deze periode.
                    </td>
                  </tr>
                )}
              </tbody>
              {rows.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-300 font-semibold">
                    <td className="py-2 pr-4" colSpan={3}>
                      Totaal
                    </td>
                    <td className="py-2 pr-4 text-right">{formatMoney(totalDebit, currency)}</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(totalCredit, currency)}</td>
                    <td className="py-2 pr-4 text-right">{formatMoney(totalDebit - totalCredit, currency)}</td>
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

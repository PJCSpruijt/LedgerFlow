import { useQuery } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { periodToRange, formatMoney } from "../lib/period";

interface Tx {
  date: string;
  glAccountCode: string;
  glAccountName: string;
  accountType: string;
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

function ConfidenceBadge({ c }: { c?: "EXACT" | "INFERRED" | "REQUIRED" }) {
  if (!c) return null;
  const map = {
    EXACT: "bg-emerald-100 text-emerald-800",
    INFERRED: "bg-blue-100 text-blue-800",
    REQUIRED: "bg-amber-100 text-amber-800",
  } as const;
  const label = { EXACT: "Mapping", INFERRED: "Afgeleid", REQUIRED: "Mapping vereist" }[c];
  return <span className={`lf-pill ${map[c]}`}>{label}</span>;
}

export function TransactionsPage() {
  const { entity, period, currency } = useScope();
  const range = periodToRange(period);

  const { data, isLoading, error, isError } = useQuery({
    queryKey: ["transactions", entity?.id, range.from, range.to],
    queryFn: () => api<{ rows: Tx[] }>(`/api/yuki/transactions?from=${range.from}&to=${range.to}`),
    enabled: !!entity,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Transacties</h1>
        <p className="text-sm text-slate-500 mt-1">
          {entity ? `${entity.name} · ${range.from} t/m ${range.to}` : "Selecteer een administratie"}
        </p>
      </div>

      {!entity && (
        <div className="lf-card max-w-2xl">Selecteer een administratie in de bovenbalk.</div>
      )}
      {entity && isLoading && <div className="lf-card">Transacties laden…</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">
          {error instanceof ApiError ? error.message : "Kon transacties niet laden"}
        </div>
      )}

      {entity && data && (
        <div className="lf-card">
          <div className="text-xs text-slate-500 mb-2">{data.rows.length} regels</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-3 font-medium">Datum</th>
                  <th className="py-2 pr-3 font-medium">Code</th>
                  <th className="py-2 pr-3 font-medium">Grootboek</th>
                  <th className="py-2 pr-3 font-medium text-right">Bedrag</th>
                  <th className="py-2 pr-3 font-medium">Relatie</th>
                  <th className="py-2 pr-3 font-medium">Referentie</th>
                  <th className="py-2 pr-3 font-medium">Documenttype</th>
                  <th className="py-2 pr-3 font-medium">Omschrijving</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((t, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1.5 pr-3 whitespace-nowrap">{t.date}</td>
                    <td className="py-1.5 pr-3 font-mono">{t.glAccountCode}</td>
                    <td className="py-1.5 pr-3">
                      {t.glAccountName}
                      {t.generatedByConnector && (
                        <span className="ml-2">
                          <ConfidenceBadge c={t.mappingConfidence} />
                        </span>
                      )}
                    </td>
                    <td
                      className={`py-1.5 pr-3 text-right whitespace-nowrap ${
                        t.amount < 0 ? "text-red-600" : ""
                      }`}
                    >
                      {formatMoney(t.amount, t.currency || currency)}
                    </td>
                    <td className="py-1.5 pr-3">{t.contactName ?? ""}</td>
                    <td className="py-1.5 pr-3">{t.reference ?? ""}</td>
                    <td className="py-1.5 pr-3">{t.documentType ?? ""}</td>
                    <td className="py-1.5 pr-3 max-w-md truncate" title={t.description}>
                      {t.description}
                    </td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-3 text-slate-400">
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

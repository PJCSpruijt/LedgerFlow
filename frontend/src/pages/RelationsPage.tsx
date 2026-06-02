import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { ExportButtons } from "../components/ExportButtons";

interface Contact {
  id: string;
  name: string;
  code: string | null;
  isDebtor: boolean;
  isCreditor: boolean;
}

type Mode = "all" | "receivables" | "payables";

const TITLES: Record<Mode, string> = {
  all: "Relaties",
  receivables: "Debiteuren",
  payables: "Crediteuren",
};

export function RelationsView({ mode }: { mode: Mode }) {
  const { entity } = useScope();
  const navigate = useNavigate();
  const wantDebtors = mode !== "payables";
  const wantCreditors = mode !== "receivables";

  const debtorsQ = useQuery({
    queryKey: ["debtors", entity?.id],
    queryFn: () => api<{ contacts: Contact[] }>("/api/ledger/debtors"),
    enabled: !!entity && wantDebtors,
  });
  const creditorsQ = useQuery({
    queryKey: ["creditors", entity?.id],
    queryFn: () => api<{ contacts: Contact[] }>("/api/ledger/creditors"),
    enabled: !!entity && wantCreditors,
  });

  const loading = (wantDebtors && debtorsQ.isLoading) || (wantCreditors && creditorsQ.isLoading);
  const err =
    (debtorsQ.error as ApiError | undefined) ?? (creditorsQ.error as ApiError | undefined);

  // Merge by id so a relation that's both debtor and creditor shows once.
  const byId = new Map<string, Contact>();
  for (const c of debtorsQ.data?.contacts ?? []) byId.set(c.id, { ...c });
  for (const c of creditorsQ.data?.contacts ?? []) {
    const cur = byId.get(c.id);
    if (cur) byId.set(c.id, { ...cur, isCreditor: true });
    else byId.set(c.id, { ...c });
  }
  const contacts = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{TITLES[mode]}</h1>
          <p className="text-sm text-slate-500 mt-1">
            {entity ? entity.name : "Selecteer een administratie"}
          </p>
        </div>
        {entity && !loading && !err && contacts.length > 0 && (
          <ExportButtons
            filename={`relaties-${mode}`}
            sheetName={TITLES[mode]}
            getRows={() =>
              contacts.map((c) => ({
                code: c.code ?? "",
                naam: c.name,
                debiteur: c.isDebtor ? "ja" : "",
                crediteur: c.isCreditor ? "ja" : "",
              }))
            }
          />
        )}
      </div>

      {!entity && <div className="lf-card max-w-2xl">Selecteer een administratie in de bovenbalk.</div>}
      {entity && loading && <div className="lf-card">Relaties laden…</div>}
      {err && (
        <div className="lf-card text-sm text-red-600">
          {err instanceof ApiError ? err.message : "Kon relaties niet laden"}
        </div>
      )}

      {entity && !loading && !err && (
        <div className="lf-card">
          <div className="text-xs text-slate-500 mb-2">
            {contacts.length} relaties · klik een relatie voor de transacties
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-4 font-medium">Code</th>
                  <th className="py-2 pr-4 font-medium">Naam</th>
                  {mode === "all" && <th className="py-2 pr-4 font-medium">Type</th>}
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-slate-100 cursor-pointer hover:bg-slate-50"
                    title="Bekijk transacties van deze relatie"
                    onClick={() => navigate(`/data/transactions?relation=${encodeURIComponent(c.name)}`)}
                  >
                    <td className="py-1.5 pr-4 font-mono">{c.code ?? ""}</td>
                    <td className="py-1.5 pr-4">{c.name}</td>
                    {mode === "all" && (
                      <td className="py-1.5 pr-4">
                        {c.isDebtor && (
                          <span className="lf-pill bg-blue-100 text-blue-800 mr-1">Debiteur</span>
                        )}
                        {c.isCreditor && (
                          <span className="lf-pill bg-amber-100 text-amber-800">Crediteur</span>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {contacts.length === 0 && (
                  <tr>
                    <td colSpan={mode === "all" ? 3 : 2} className="py-3 text-slate-400">
                      Geen relaties gevonden.
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

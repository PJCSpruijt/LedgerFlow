import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { formatMoney } from "../lib/period";
import { RgsCodeSearch } from "../components/RgsCodeSearch";

interface Adjustment {
  id: string;
  description: string;
  debitRgsCode: string;
  creditRgsCode: string;
  amount: number;
  currency: string;
  effectiveDate: string;
  groupId: string | null;
}

/**
 * Manual consolidation corrections: double-entry journals (debit RGS / credit
 * RGS) applied on top of the consolidated figures. For corrections the automatic
 * intercompany elimination can't infer (e.g. unrealised intercompany profit).
 */
export function ConsolidationAdjustmentsPage() {
  const { workspace, group, dateTo, currency } = useScope();
  const qc = useQueryClient();
  const [form, setForm] = useState({ description: "", debitRgsCode: "", creditRgsCode: "", amount: "", effectiveDate: dateTo });

  const listQ = useQuery({
    queryKey: ["consolidation-adjustments", workspace?.id, group?.id],
    queryFn: () => api<{ adjustments: Adjustment[] }>("/api/consolidation/adjustments"),
    enabled: !!workspace,
  });

  const create = useMutation({
    mutationFn: () =>
      api("/api/consolidation/adjustments", {
        method: "POST",
        body: {
          description: form.description,
          debitRgsCode: form.debitRgsCode,
          creditRgsCode: form.creditRgsCode,
          amount: Number(form.amount),
          currency,
          effectiveDate: form.effectiveDate,
          scope: group ? "group" : "workspace",
        },
      }),
    onSuccess: () => {
      setForm({ description: "", debitRgsCode: "", creditRgsCode: "", amount: "", effectiveDate: dateTo });
      qc.invalidateQueries({ queryKey: ["consolidation-adjustments"] });
      qc.invalidateQueries({ queryKey: ["consolidation"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/consolidation/adjustments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["consolidation-adjustments"] });
      qc.invalidateQueries({ queryKey: ["consolidation"] });
    },
  });

  const valid = form.description.trim() && form.debitRgsCode && form.creditRgsCode && Number(form.amount) > 0 && form.effectiveDate;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Consolidatiecorrecties</h1>
        <p className="text-sm text-slate-500 mt-1">
          Handmatige consolidatieboekingen (debet/credit op RGS) bovenop de automatische intercompany-eliminatie — voor
          correcties die niet automatisch zijn af te leiden, zoals niet-gerealiseerde intercompany-winst in voorraad of
          herrubriceringen. Verschijnen in de geconsolideerde overzichten in de weergave "Na eliminaties".
        </p>
      </div>

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte in de bovenbalk.</div>}

      {workspace && (
        <div className="lf-card">
          <h2 className="font-semibold mb-3">Nieuwe correctie</h2>
          <div className="space-y-3">
            <div>
              <label className="lf-label">Omschrijving</label>
              <input
                className="lf-input"
                placeholder="bijv. Eliminatie intercompany-winst in voorraad"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div className="flex flex-wrap gap-4">
              <div>
                <label className="lf-label">Debet (RGS)</label>
                {form.debitRgsCode ? (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{form.debitRgsCode}</span>
                    <button className="text-xs text-slate-400 hover:text-red-500" onClick={() => setForm({ ...form, debitRgsCode: "" })}>
                      wijzig
                    </button>
                  </div>
                ) : (
                  <RgsCodeSearch onPick={(code) => setForm({ ...form, debitRgsCode: code })} />
                )}
              </div>
              <div>
                <label className="lf-label">Credit (RGS)</label>
                {form.creditRgsCode ? (
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{form.creditRgsCode}</span>
                    <button className="text-xs text-slate-400 hover:text-red-500" onClick={() => setForm({ ...form, creditRgsCode: "" })}>
                      wijzig
                    </button>
                  </div>
                ) : (
                  <RgsCodeSearch onPick={(code) => setForm({ ...form, creditRgsCode: code })} />
                )}
              </div>
              <div>
                <label className="lf-label">Bedrag ({currency})</label>
                <input
                  className="lf-input w-36"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                />
              </div>
              <div>
                <label className="lf-label">Boekdatum</label>
                <input
                  className="lf-input w-40"
                  type="date"
                  value={form.effectiveDate}
                  onChange={(e) => setForm({ ...form, effectiveDate: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button className="lf-btn-primary" disabled={!valid || create.isPending} onClick={() => create.mutate()}>
                {create.isPending ? "Opslaan…" : "Correctie toevoegen"}
              </button>
              <span className="text-xs text-slate-400">
                Scope: {group ? `groep ${group.name}` : `werkruimte ${workspace.name}`}
              </span>
            </div>
            {create.isError && (
              <p className="text-xs text-red-600">{create.error instanceof ApiError ? create.error.message : "Opslaan mislukt"}</p>
            )}
          </div>
        </div>
      )}

      {listQ.isLoading && <div className="lf-card">Correcties laden…</div>}
      {listQ.data && listQ.data.adjustments.length === 0 && (
        <div className="lf-card text-sm text-slate-500">Nog geen consolidatiecorrecties.</div>
      )}

      {listQ.data && listQ.data.adjustments.length > 0 && (
        <div className="lf-card overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-4">Datum</th>
                <th className="py-2 pr-4">Omschrijving</th>
                <th className="py-2 pr-4">Debet</th>
                <th className="py-2 pr-4">Credit</th>
                <th className="py-2 pr-4 text-right">Bedrag</th>
                <th className="py-2 pr-4">Scope</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {listQ.data.adjustments.map((a) => (
                <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-1.5 pr-4 whitespace-nowrap">{a.effectiveDate}</td>
                  <td className="py-1.5 pr-4">{a.description}</td>
                  <td className="py-1.5 pr-4 font-mono text-xs">{a.debitRgsCode}</td>
                  <td className="py-1.5 pr-4 font-mono text-xs">{a.creditRgsCode}</td>
                  <td className="py-1.5 pr-4 text-right whitespace-nowrap">{formatMoney(a.amount, a.currency)}</td>
                  <td className="py-1.5 pr-4 text-xs">{a.groupId ? "Groep" : "Werkruimte"}</td>
                  <td className="py-1.5 pr-4 text-right">
                    <button
                      className="text-slate-400 hover:text-red-600 text-xs"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (confirm("Correctie verwijderen?")) remove.mutate(a.id);
                      }}
                    >
                      Verwijderen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

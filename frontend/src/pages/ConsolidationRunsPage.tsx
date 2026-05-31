import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";
import { ConsolidatedStatementsPage, type ConsolResult } from "./ConsolidatedStatementsPage";

interface RunSummary {
  id: string;
  label: string;
  scope: "group" | "workspace";
  groupId: string | null;
  fromDate: string;
  toDate: string;
  currency: string;
  eliminate: boolean;
  entityCount: number;
  createdAt: string;
}

const fmtDateTime = (s: string) => new Date(s).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" });

/**
 * Consolidation runs: freeze the current consolidation as a reproducible
 * snapshot, browse earlier runs, and open one read-only.
 */
export function ConsolidationRunsPage() {
  const { workspace, group, dateFrom, dateTo, currency } = useScope();
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [eliminate, setEliminate] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const runsQ = useQuery({
    queryKey: ["consolidation-runs", workspace?.id],
    queryFn: () => api<{ runs: RunSummary[] }>("/api/consolidation/runs"),
    enabled: !!workspace,
  });

  const runQ = useQuery({
    queryKey: ["consolidation-run", openId],
    queryFn: () => api<{ run: RunSummary & { snapshot: ConsolResult } }>(`/api/consolidation/runs/${openId}`),
    enabled: !!openId,
  });

  const create = useMutation({
    mutationFn: () =>
      api<{ run: RunSummary }>("/api/consolidation/runs", {
        method: "POST",
        body: { label, from: dateFrom, to: dateTo, currency, eliminate, scope: group ? "group" : "workspace" },
      }),
    onSuccess: () => {
      setLabel("");
      qc.invalidateQueries({ queryKey: ["consolidation-runs"] });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/consolidation/runs/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["consolidation-runs"] }),
  });

  // Detail view of a saved run.
  if (openId) {
    return (
      <div className="space-y-4">
        <button className="lf-link text-sm" onClick={() => setOpenId(null)}>
          ← Terug naar consolidatieruns
        </button>
        {runQ.isLoading && <div className="lf-card">Snapshot laden…</div>}
        {runQ.isError && <div className="lf-card text-sm text-red-600">Kon de run niet laden.</div>}
        {runQ.data && (
          <>
            <div className="lf-card bg-slate-50">
              <div className="text-sm font-medium">{runQ.data.run.label}</div>
              <div className="text-xs text-slate-500 mt-1">
                Vastgelegd {fmtDateTime(runQ.data.run.createdAt)} · {runQ.data.run.fromDate} t/m {runQ.data.run.toDate} ·{" "}
                {runQ.data.run.currency} · {runQ.data.run.entityCount} administratie(s)
                {runQ.data.run.eliminate ? " · na intercompany-eliminatie" : ""}
                <span className="ml-2 px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">momentopname</span>
              </div>
            </div>
            <ConsolidatedStatementsPage show="both" snapshot={runQ.data.run.snapshot} />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Consolidatieruns</h1>
        <p className="text-sm text-slate-500 mt-1">
          Leg het geconsolideerde resultaat op een peilmoment vast. Een vastgelegde run is een momentopname die niet
          meebeweegt met latere wijzigingen in de brondata — handig voor rapportage en audit.
        </p>
      </div>

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte in de bovenbalk.</div>}

      {workspace && (
        <div className="lf-card">
          <h2 className="font-semibold mb-2">Nieuwe run vastleggen</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="lf-label">Naam (optioneel)</label>
              <input
                className="lf-input"
                placeholder={`Consolidatie ${dateFrom} t/m ${dateTo}`}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 text-sm pb-2">
              <input type="checkbox" checked={eliminate} onChange={(e) => setEliminate(e.target.checked)} />
              Intercompany elimineren
            </label>
            <button className="lf-btn-primary" disabled={create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Vastleggen…" : "Vastleggen"}
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-2">
            Scope: {group ? `groep ${group.name}` : `werkruimte ${workspace.name}`} · periode {dateFrom} t/m {dateTo} ·{" "}
            {currency}
          </p>
          {create.isError && (
            <p className="text-xs text-red-600 mt-1">
              {create.error instanceof ApiError ? create.error.message : "Vastleggen mislukt"}
            </p>
          )}
        </div>
      )}

      {runsQ.isLoading && <div className="lf-card">Runs laden…</div>}
      {runsQ.data && runsQ.data.runs.length === 0 && (
        <div className="lf-card text-sm text-slate-500">Nog geen consolidatieruns vastgelegd.</div>
      )}

      {runsQ.data && runsQ.data.runs.length > 0 && (
        <div className="lf-card overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-200 text-slate-500">
                <th className="py-2 pr-4">Naam</th>
                <th className="py-2 pr-4">Periode</th>
                <th className="py-2 pr-4">Scope</th>
                <th className="py-2 pr-4 text-right">Adm.</th>
                <th className="py-2 pr-4">Eliminatie</th>
                <th className="py-2 pr-4">Vastgelegd</th>
                <th className="py-2 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {runsQ.data.runs.map((r) => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-1.5 pr-4">
                    <button className="lf-link" onClick={() => setOpenId(r.id)}>
                      {r.label}
                    </button>
                  </td>
                  <td className="py-1.5 pr-4 whitespace-nowrap">{r.fromDate} t/m {r.toDate}</td>
                  <td className="py-1.5 pr-4">{r.scope === "group" ? "Groep" : "Werkruimte"}</td>
                  <td className="py-1.5 pr-4 text-right">{r.entityCount}</td>
                  <td className="py-1.5 pr-4">{r.eliminate ? "Ja" : "Nee"}</td>
                  <td className="py-1.5 pr-4 whitespace-nowrap text-slate-500">{fmtDateTime(r.createdAt)}</td>
                  <td className="py-1.5 pr-4 text-right">
                    <button
                      className="text-slate-400 hover:text-red-600 text-xs"
                      disabled={remove.isPending}
                      onClick={() => {
                        if (confirm(`Run "${r.label}" verwijderen?`)) remove.mutate(r.id);
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

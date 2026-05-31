import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api, ApiError } from "../services/api";

interface IcRelation {
  relationId: string;
  relationName: string;
  relationCode: string | null;
  isDebtor: boolean;
  isCreditor: boolean;
  counterpartyEntityId: string | null;
  suggestedEntityId: string | null;
}
interface IcBlock {
  entityId: string;
  entityName: string;
  relations: IcRelation[];
}
interface IcList {
  entities: { id: string; name: string }[];
  blocks: IcBlock[];
  warnings: string[];
}

/**
 * Intercompany matching: mark which relations (debtor/creditor) in each
 * administration are actually another administration in the workspace. Those
 * mappings drive automatic elimination of mutual balances on consolidation.
 */
export function IntercompanyMatchingPage() {
  const { workspace, group, entity } = useScope();
  const qc = useQueryClient();
  const [candidatesOnly, setCandidatesOnly] = useState(false);
  const [q, setQ] = useState("");

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["intercompany", workspace?.id, group?.id, entity?.id],
    queryFn: () => api<IcList>("/api/consolidation/intercompany"),
    enabled: !!workspace,
  });

  const setMutation = useMutation({
    mutationFn: (b: { entityId: string; relationId: string; relationCode: string | null; relationName: string | null; counterpartyEntityId: string | null }) =>
      api("/api/consolidation/intercompany", { method: "POST", body: b }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intercompany"] });
      qc.invalidateQueries({ queryKey: ["consolidation"] });
    },
  });

  const nameOf = (id: string | null) => data?.entities.find((e) => e.id === id)?.name ?? null;
  const mappedCount = (data?.blocks ?? []).reduce((s, b) => s + b.relations.filter((r) => r.counterpartyEntityId).length, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Intercompany-matching</h1>
        <p className="text-sm text-slate-500 mt-1">
          Geef per administratie aan welke relaties (debiteur/crediteur) eigenlijk een andere administratie in de
          werkruimte zijn. Onderlinge saldi worden dan automatisch geëlimineerd bij consolidatie.
        </p>
      </div>

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte in de bovenbalk.</div>}
      {workspace && isLoading && <div className="lf-card">Relaties laden…</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">{error instanceof ApiError ? error.message : "Kon relaties niet laden"}</div>
      )}

      {data && (
        <div className="text-xs text-slate-500">
          {mappedCount} intercompany-koppeling{mappedCount === 1 ? "" : "en"} actief over {data.blocks.length} administratie(s).
        </div>
      )}

      {data && data.warnings.length > 0 && (
        <div className="lf-card bg-amber-50 ring-amber-200 text-amber-900 text-sm space-y-1">
          {data.warnings.map((w, i) => (
            <div key={i}>⚠️ {w}</div>
          ))}
        </div>
      )}

      {data && (
        <div className="flex items-center gap-4 flex-wrap">
          <input
            className="lf-input text-sm h-9 w-64"
            placeholder="Zoek op relatie of code…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={candidatesOnly} onChange={(e) => setCandidatesOnly(e.target.checked)} />
            Alleen koppelbaar (gekoppeld of met suggestie)
          </label>
        </div>
      )}

      {data?.blocks.map((b) => {
        const term = q.trim().toLowerCase();
        const rels = b.relations.filter((r) => {
          if (candidatesOnly && !r.counterpartyEntityId && !r.suggestedEntityId) return false;
          if (term && !((r.relationName ?? "").toLowerCase().includes(term) || (r.relationCode ?? "").toLowerCase().includes(term)))
            return false;
          return true;
        });
        // Hide administrations with nothing matching while a filter is active.
        if ((candidatesOnly || term) && rels.length === 0) return null;
        return (
        <div key={b.entityId} className="lf-card">
          <h2 className="text-lg font-semibold mb-2">{b.entityName}</h2>
          {rels.length === 0 ? (
            <p className="text-sm text-slate-400">Geen relaties gevonden (of koppeling niet ingesteld).</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 pr-4">Relatie</th>
                  <th className="py-1.5 pr-4">Code</th>
                  <th className="py-1.5 pr-4">Type</th>
                  <th className="py-1.5 pr-4">Is administratie…</th>
                </tr>
              </thead>
              <tbody>
                {rels.map((r) => {
                  const options = data.entities.filter((e) => e.id !== b.entityId);
                  const suggestion = r.suggestedEntityId && !r.counterpartyEntityId ? nameOf(r.suggestedEntityId) : null;
                  return (
                    <tr key={r.relationId} className="border-b border-slate-50">
                      <td className="py-1.5 pr-4">{r.relationName}</td>
                      <td className="py-1.5 pr-4 font-mono text-slate-500">{r.relationCode ?? "—"}</td>
                      <td className="py-1.5 pr-4 text-xs">
                        {r.isDebtor && <span className="mr-1 px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">Debiteur</span>}
                        {r.isCreditor && <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">Crediteur</span>}
                      </td>
                      <td className="py-1.5 pr-4">
                        <div className="flex items-center gap-2">
                          <select
                            className="lf-input text-xs h-8 py-0 w-56"
                            value={r.counterpartyEntityId ?? ""}
                            disabled={setMutation.isPending}
                            onChange={(e) =>
                              setMutation.mutate({
                                entityId: b.entityId,
                                relationId: r.relationId,
                                relationCode: r.relationCode,
                                relationName: r.relationName,
                                counterpartyEntityId: e.target.value || null,
                              })
                            }
                          >
                            <option value="">— externe relatie —</option>
                            {options.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                          </select>
                          {suggestion && (
                            <button
                              className="lf-link text-xs whitespace-nowrap"
                              onClick={() =>
                                setMutation.mutate({
                                  entityId: b.entityId,
                                  relationId: r.relationId,
                                  relationCode: r.relationCode,
                                  relationName: r.relationName,
                                  counterpartyEntityId: r.suggestedEntityId,
                                })
                              }
                            >
                              ✨ {suggestion}?
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        );
      })}
    </div>
  );
}

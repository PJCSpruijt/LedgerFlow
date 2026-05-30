import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../services/api";
import { useScope } from "../contexts/ScopeContext";

interface Entry {
  entityId: string;
  entityName: string;
  sourceCode: string;
  sourceName: string;
}
interface RgsGroup {
  rgsCode: string;
  description: string;
  level: number;
  side: "B" | "W" | null;
  finCategories: string[];
  count: number;
  entries: Entry[];
}
interface UniversalResponse {
  version: string;
  entities: { id: string; name: string }[];
  groups: RgsGroup[];
  unmapped: Entry[];
}

const sideLabel = (s: "B" | "W" | null) => (s === "B" ? "Balans" : s === "W" ? "W&V" : "—");

/**
 * Toewijzingen → Universeel rekeningschema: the consolidated, normalized chart.
 * Shows the RGS codes in use across the scope (workspace / group / entity) with
 * drill-down to the underlying source accounts per administration. Read-only;
 * actual mapping happens on the "Rekeningkoppelingen (RGS)" page.
 */
export function UniversalChartPage() {
  const { workspace, group, entity } = useScope();
  const navigate = useNavigate();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [showUnmapped, setShowUnmapped] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["universal-chart", workspace?.id, group?.id, entity?.id],
    queryFn: () => api<UniversalResponse>("/api/rgs-mappings/universal"),
    enabled: !!workspace,
  });

  const toggle = (code: string) =>
    setOpen((p) => {
      const n = new Set(p);
      n.has(code) ? n.delete(code) : n.add(code);
      return n;
    });

  const scopeLabel = entity ? entity.name : group ? group.name : workspace?.name ?? "";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Universeel rekeningschema</h1>
        <p className="text-sm text-slate-500 mt-1">
          Het geconsolideerde, genormaliseerde schema: de RGS-codes die over de administraties heen
          in gebruik zijn. Koppelen doe je op{" "}
          <button className="lf-link" onClick={() => navigate("/mappings/rgs")}>
            Rekeningkoppelingen (RGS)
          </button>
          .
        </p>
      </div>

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte.</div>}
      {workspace && isLoading && <div className="lf-card">Laden…</div>}
      {isError && (
        <div className="lf-card text-sm text-red-600">
          {error instanceof ApiError ? error.message : "Kon het schema niet laden"}
        </div>
      )}

      {data && (
        <>
          <div className="text-xs text-slate-500">
            Scope: {scopeLabel} · {data.entities.length} administratie
            {data.entities.length === 1 ? "" : "s"} · RGS {data.version} · {data.groups.length} codes in
            gebruik
            {data.unmapped.length > 0 && (
              <>
                {" · "}
                <button className="lf-link" onClick={() => setShowUnmapped((v) => !v)}>
                  {data.unmapped.length} nog niet gekoppeld
                </button>
              </>
            )}
          </div>

          {showUnmapped && data.unmapped.length > 0 && (
            <div className="lf-card p-0">
              <div className="px-4 py-2 text-xs font-medium text-amber-700 border-b border-slate-100">
                Nog niet gekoppelde bronrekeningen
              </div>
              <div className="overflow-auto max-h-64">
                <table className="w-full text-sm">
                  <tbody>
                    {data.unmapped.map((e, i) => (
                      <tr key={i} className="border-b border-slate-50">
                        <td className="py-1.5 px-3 whitespace-nowrap">
                          <span className="font-mono text-slate-500 mr-2">{e.sourceCode}</span>
                          {e.sourceName}
                        </td>
                        <td className="py-1.5 px-3 text-slate-500 whitespace-nowrap">{e.entityName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {data.groups.length === 0 ? (
            <div className="lf-card">
              Nog geen koppelingen in deze scope. Ga naar{" "}
              <button className="lf-link" onClick={() => navigate("/mappings/rgs")}>
                Rekeningkoppelingen (RGS)
              </button>{" "}
              om bronrekeningen aan RGS te koppelen.
            </div>
          ) : (
            <div className="lf-card p-0">
              <div className="overflow-auto max-h-[calc(100vh-240px)]">
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-10 bg-slate-50">
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-2 px-3 font-medium">RGS-code</th>
                      <th className="py-2 px-3 font-medium">Omschrijving</th>
                      <th className="py-2 px-3 font-medium">B/W</th>
                      <th className="py-2 px-3 font-medium">FIN</th>
                      <th className="py-2 px-3 font-medium text-right">Bronrekeningen</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.groups.map((g) => {
                      const isOpen = open.has(g.rgsCode);
                      return (
                        <Fragment key={g.rgsCode}>
                          <tr
                            className="border-b border-slate-100 cursor-pointer hover:bg-slate-50"
                            onClick={() => toggle(g.rgsCode)}
                          >
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span className="inline-block w-4 text-slate-400">{isOpen ? "▾" : "▸"}</span>
                              <span className="font-mono bg-emerald-50 text-emerald-800 px-1.5 rounded">
                                {g.rgsCode}
                              </span>
                            </td>
                            <td className="py-2 px-3">{g.description}</td>
                            <td className="py-2 px-3 text-slate-500 whitespace-nowrap">{sideLabel(g.side)}</td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              {g.finCategories.map((f) => (
                                <span key={f} className="lf-pill bg-blue-100 text-blue-800 mr-1">
                                  {f}
                                </span>
                              ))}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-600">{g.count}</td>
                          </tr>
                          {isOpen &&
                            g.entries.map((e, i) => (
                              <tr key={i} className="border-b border-slate-50 text-slate-600">
                                <td className="py-1.5 px-3 pl-9 whitespace-nowrap font-mono text-slate-500">
                                  {e.sourceCode}
                                </td>
                                <td className="py-1.5 px-3">{e.sourceName}</td>
                                <td className="py-1.5 px-3" />
                                <td className="py-1.5 px-3" />
                                <td className="py-1.5 px-3 text-right whitespace-nowrap text-slate-500">
                                  {e.entityName}
                                </td>
                              </tr>
                            ))}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

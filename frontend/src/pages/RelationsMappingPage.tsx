import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api } from "../services/api";
import { ErrorNotice } from "../components/ErrorNotice";

interface Member {
  entityId: string;
  entityName: string;
  relationId: string;
  relationName: string;
  code: string | null;
  isDebtor: boolean;
  isCreditor: boolean;
  manual: boolean;
}
interface Canonical {
  key: string;
  displayName: string;
  adminCount: number;
  memberCount: number;
  isDebtor: boolean;
  isCreditor: boolean;
  vatNumber: string | null;
  email: string | null;
  members: Member[];
}
interface CanonicalResult { entities: { id: string; name: string }[]; relations: Canonical[]; warnings: string[] }

/**
 * Universal relation mapping: the same external party across administrations is
 * grouped into one canonical relation (auto by name). Admins can merge
 * differently-named relations into one group or detach them.
 */
export function RelationsMappingPage() {
  const { workspace, group } = useScope();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [onlyCross, setOnlyCross] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["canonical-relations", workspace?.id, group?.id],
    queryFn: () => api<CanonicalResult>("/api/relations/canonical"),
    enabled: !!workspace,
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["canonical-relations"] });

  const moveMut = useMutation({
    mutationFn: (b: { entityId: string; relationId: string; relationName: string; canonicalKey: string; displayName: string }) =>
      api("/api/relations/override", { method: "POST", body: b }),
    onSuccess: invalidate,
  });
  const detachMut = useMutation({
    mutationFn: (m: { entityId: string; relationId: string }) =>
      api(`/api/relations/override?entityId=${encodeURIComponent(m.entityId)}&relationId=${encodeURIComponent(m.relationId)}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
  const renameMut = useMutation({
    mutationFn: (b: { canonicalKey: string; displayName: string }) => api("/api/relations/rename", { method: "POST", body: b }),
    onSuccess: () => { setRenaming(null); invalidate(); },
  });

  const groupOptions = useMemo(
    () => (data?.relations ?? []).map((g) => ({ key: g.key, label: g.displayName })).sort((a, b) => a.label.localeCompare(b.label)),
    [data],
  );

  const rels = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.relations ?? []).filter((g) => {
      if (onlyCross && g.adminCount < 2) return false;
      if (term && !(g.displayName.toLowerCase().includes(term) || g.members.some((m) => m.relationName.toLowerCase().includes(term)))) return false;
      return true;
    });
  }, [data, q, onlyCross]);

  const crossCount = (data?.relations ?? []).filter((g) => g.adminCount > 1).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Relatiekoppelingen</h1>
        <p className="text-sm text-slate-500 mt-1">
          Dezelfde externe partij over administraties heen wordt automatisch tot één canonieke relatie gegroepeerd (op
          naam). Koppel afwijkend benoemde relaties samen of maak ze los.
        </p>
      </div>

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte in de bovenbalk.</div>}
      {workspace && isLoading && <div className="lf-card">Relaties laden… (administraties worden opgehaald)</div>}
      {isError && <ErrorNotice error={error} fallback="Kon relaties niet laden" onRetry={() => refetch()} />}

      {data && data.warnings.length > 0 && (
        <div className="lf-card bg-amber-50 ring-amber-200 text-amber-900 text-sm space-y-1">
          {data.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
        </div>
      )}

      {data && (
        <div className="flex items-center gap-4 flex-wrap text-sm">
          <input className="lf-input h-9 w-72" placeholder="Zoek op relatie…" value={q} onChange={(e) => setQ(e.target.value)} />
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={onlyCross} onChange={(e) => setOnlyCross(e.target.checked)} />
            Alleen cross-administratie
          </label>
          <span className="text-xs text-slate-500">
            {data.relations.length} canonieke relaties · {crossCount} over meerdere administraties
          </span>
        </div>
      )}

      {data && rels.length === 0 && <div className="lf-card text-sm text-slate-400">Geen relaties die aan het filter voldoen.</div>}

      {rels.map((g) => (
        <div key={g.key} className="lf-card">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              {renaming === g.key ? (
                <>
                  <input className="lf-input h-8 text-sm w-64" value={renameVal} onChange={(e) => setRenameVal(e.target.value)} autoFocus />
                  <button className="lf-btn-primary text-xs h-8" disabled={renameMut.isPending || !renameVal.trim()} onClick={() => renameMut.mutate({ canonicalKey: g.key, displayName: renameVal.trim() })}>Opslaan</button>
                  <button className="text-xs text-slate-500" onClick={() => setRenaming(null)}>Annuleren</button>
                </>
              ) : (
                <>
                  <h2 className="text-base font-semibold">{g.displayName}</h2>
                  <button className="text-xs text-slate-400 hover:text-slate-700" title="Hernoemen" onClick={() => { setRenaming(g.key); setRenameVal(g.displayName); }}>✎</button>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              {g.adminCount > 1 && <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 ring-1 ring-violet-200">{g.adminCount} administraties</span>}
              {g.isDebtor && <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">Debiteur</span>}
              {g.isCreditor && <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700">Crediteur</span>}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-200 text-slate-500">
                <th className="py-1 pr-4">Administratie</th>
                <th className="py-1 pr-4">Relatie (bron)</th>
                <th className="py-1 pr-4">Code</th>
                <th className="py-1 pr-4">Hoort bij</th>
                <th className="py-1 pr-4"></th>
              </tr>
            </thead>
            <tbody>
              {g.members.map((m) => (
                <tr key={`${m.entityId}|${m.relationId}`} className="border-b border-slate-50">
                  <td className="py-1 pr-4 whitespace-nowrap">{m.entityName}</td>
                  <td className="py-1 pr-4">{m.relationName}{m.manual && <span className="ml-2 text-[10px] uppercase tracking-wide text-amber-600">handmatig</span>}</td>
                  <td className="py-1 pr-4 font-mono text-xs text-slate-500">{m.code ?? "—"}</td>
                  <td className="py-1 pr-4">
                    <select
                      className="lf-input text-xs h-8 py-0 w-56"
                      value={g.key}
                      disabled={moveMut.isPending}
                      onChange={(e) => {
                        const target = groupOptions.find((o) => o.key === e.target.value);
                        if (target && target.key !== g.key) moveMut.mutate({ entityId: m.entityId, relationId: m.relationId, relationName: m.relationName, canonicalKey: target.key, displayName: target.label });
                      }}
                    >
                      {groupOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                    </select>
                  </td>
                  <td className="py-1 pr-4 text-right">
                    {m.manual && (
                      <button className="text-xs text-slate-500 hover:underline" disabled={detachMut.isPending} onClick={() => detachMut.mutate({ entityId: m.entityId, relationId: m.relationId })}>
                        Losmaken
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

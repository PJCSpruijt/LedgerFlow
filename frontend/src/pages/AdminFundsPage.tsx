import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";

interface FundSummary { id: string; name: string; holdingCount: number; keyCount: number; createdAt: string }
interface Holding { id: string; workspaceId: string; workspaceName: string; label: string | null; stakePct: number | null }
interface FundKey { id: string; name: string; prefix: string; lastUsedAt: string | null; revokedAt: string | null; createdAt: string }
interface FundDetail extends FundSummary { holdings: Holding[]; keys: FundKey[] }
interface Ws { id: string; name: string }

/**
 * Portfolio / PE fund management (platform admin). A fund links to multiple
 * portfolio companies (workspaces) and issues fund-scoped API keys that read
 * across them via the Output API (/api/v1/portfolio/*).
 */
export function AdminFundsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [wsToAdd, setWsToAdd] = useState("");
  const [label, setLabel] = useState("");
  const [stake, setStake] = useState("");
  const [keyName, setKeyName] = useState("");
  const [rawKey, setRawKey] = useState<string | null>(null);

  const fundsQ = useQuery({ queryKey: ["funds"], queryFn: () => api<{ funds: FundSummary[] }>("/api/admin/funds") });
  const wsQ = useQuery({ queryKey: ["admin-workspaces-min"], queryFn: () => api<{ workspaces: Ws[] }>("/api/admin/workspaces") });
  const detailQ = useQuery({ queryKey: ["fund", selected], queryFn: () => api<{ fund: FundDetail }>(`/api/admin/funds/${selected}`), enabled: !!selected });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["funds"] }); if (selected) qc.invalidateQueries({ queryKey: ["fund", selected] }); };
  const createFund = useMutation({ mutationFn: () => api<{ id: string }>("/api/admin/funds", { method: "POST", body: { name: newName.trim() } }), onSuccess: (r) => { setNewName(""); setSelected(r.id); qc.invalidateQueries({ queryKey: ["funds"] }); } });
  const delFund = useMutation({ mutationFn: (id: string) => api(`/api/admin/funds/${id}`, { method: "DELETE" }), onSuccess: () => { setSelected(null); qc.invalidateQueries({ queryKey: ["funds"] }); } });
  const addHolding = useMutation({
    mutationFn: () => api(`/api/admin/funds/${selected}/holdings`, { method: "POST", body: { workspaceId: wsToAdd, label: label.trim() || null, stakePct: stake ? Number(stake) : null } }),
    onSuccess: () => { setWsToAdd(""); setLabel(""); setStake(""); invalidate(); },
  });
  const delHolding = useMutation({ mutationFn: (id: string) => api(`/api/admin/funds/holdings/${id}`, { method: "DELETE" }), onSuccess: invalidate });
  const createKey = useMutation({
    mutationFn: () => api<{ rawKey: string }>(`/api/admin/funds/${selected}/keys`, { method: "POST", body: { name: keyName.trim() } }),
    onSuccess: (r) => { setKeyName(""); setRawKey(r.rawKey); invalidate(); },
  });
  const revokeKey = useMutation({ mutationFn: (id: string) => api(`/api/admin/funds/keys/${id}`, { method: "DELETE" }), onSuccess: invalidate });

  const fund = detailQ.data?.fund;
  const base = `${window.location.origin}/api/v1`;
  const availableWs = (wsQ.data?.workspaces ?? []).filter((w) => !fund?.holdings.some((h) => h.workspaceId === w.id));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Fondsen / Portfolio</h1>
        <p className="text-sm text-slate-500 mt-1">
          PE-/investeringsfondsen die met één sleutel financiële data over meerdere portfoliobedrijven lezen via de Output API.
        </p>
      </div>

      <div className="lf-card max-w-xl flex items-end gap-2">
        <label className="text-xs text-slate-500 flex-1">Nieuw fonds
          <input className="lf-input h-9 text-sm w-full block mt-0.5" placeholder="Fondsnaam" value={newName} onChange={(e) => setNewName(e.target.value)} />
        </label>
        <button className="lf-btn-primary text-sm h-9" disabled={!newName.trim() || createFund.isPending} onClick={() => createFund.mutate()}>Aanmaken</button>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="lf-card p-0 md:col-span-1">
          <div className="px-3 py-2 text-xs text-slate-500 border-b border-slate-100">Fondsen ({fundsQ.data?.funds.length ?? 0})</div>
          <ul>
            {fundsQ.data?.funds.map((f) => (
              <li key={f.id}>
                <button className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 ${selected === f.id ? "bg-brand-50" : ""}`} onClick={() => { setSelected(f.id); setRawKey(null); }}>
                  <div className="font-medium">{f.name}</div>
                  <div className="text-xs text-slate-400">{f.holdingCount} bedrijven · {f.keyCount} sleutel(s)</div>
                </button>
              </li>
            ))}
            {fundsQ.data?.funds.length === 0 && <li className="px-3 py-3 text-sm text-slate-400">Nog geen fondsen.</li>}
          </ul>
        </div>

        <div className="md:col-span-2 space-y-4">
          {!fund && <div className="lf-card text-sm text-slate-400">Selecteer of maak een fonds.</div>}
          {fund && (
            <>
              <div className="lf-card">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{fund.name}</h2>
                  <button className="text-xs text-rose-600 hover:underline" onClick={() => { if (confirm(`Fonds "${fund.name}" verwijderen?`)) delFund.mutate(fund.id); }}>Fonds verwijderen</button>
                </div>
                <p className="text-xs text-slate-400 font-mono mt-1">Output API: {base}/portfolio/companies · {base}/portfolio/summary</p>
              </div>

              <div className="lf-card">
                <h3 className="text-base font-semibold mb-2">Portfoliobedrijven ({fund.holdings.length})</h3>
                <div className="flex items-end gap-2 flex-wrap mb-3">
                  <select className="lf-input h-9 text-sm w-56" value={wsToAdd} onChange={(e) => setWsToAdd(e.target.value)}>
                    <option value="">— werkruimte kiezen —</option>
                    {availableWs.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                  <input className="lf-input h-9 text-sm w-28" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} />
                  <input className="lf-input h-9 text-sm w-24" placeholder="Belang %" value={stake} onChange={(e) => setStake(e.target.value)} />
                  <button className="lf-btn-secondary text-sm h-9" disabled={!wsToAdd || addHolding.isPending} onClick={() => addHolding.mutate()}>Toevoegen</button>
                </div>
                {fund.holdings.length === 0 ? <p className="text-sm text-slate-400">Nog geen bedrijven gekoppeld.</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left border-b border-slate-200 text-slate-500"><th className="py-1 pr-4">Bedrijf</th><th className="py-1 pr-4">Label</th><th className="py-1 pr-4">Belang</th><th></th></tr></thead>
                    <tbody>
                      {fund.holdings.map((h) => (
                        <tr key={h.id} className="border-b border-slate-50">
                          <td className="py-1 pr-4">{h.workspaceName}</td>
                          <td className="py-1 pr-4 text-slate-500">{h.label ?? "—"}</td>
                          <td className="py-1 pr-4 text-slate-500">{h.stakePct != null ? `${h.stakePct}%` : "—"}</td>
                          <td className="py-1 pr-4 text-right"><button className="text-xs text-rose-600 hover:underline" onClick={() => delHolding.mutate(h.id)}>Verwijderen</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="lf-card">
                <h3 className="text-base font-semibold mb-2">Fonds-API-sleutels</h3>
                {rawKey && (
                  <div className="mb-3 text-sm bg-emerald-50 ring-1 ring-emerald-200 rounded p-2">
                    <div className="text-emerald-800 mb-1">Nieuwe sleutel (eenmalig zichtbaar — kopieer hem nu):</div>
                    <code className="font-mono text-xs break-all">{rawKey}</code>
                  </div>
                )}
                <div className="flex items-end gap-2 mb-3">
                  <input className="lf-input h-9 text-sm w-56" placeholder="Sleutelnaam (bijv. PowerBI)" value={keyName} onChange={(e) => setKeyName(e.target.value)} />
                  <button className="lf-btn-secondary text-sm h-9" disabled={!keyName.trim() || createKey.isPending} onClick={() => createKey.mutate()}>Sleutel aanmaken</button>
                </div>
                {fund.keys.length === 0 ? <p className="text-sm text-slate-400">Nog geen sleutels.</p> : (
                  <table className="w-full text-sm">
                    <thead><tr className="text-left border-b border-slate-200 text-slate-500"><th className="py-1 pr-4">Naam</th><th className="py-1 pr-4">Prefix</th><th className="py-1 pr-4">Status</th><th></th></tr></thead>
                    <tbody>
                      {fund.keys.map((k) => (
                        <tr key={k.id} className="border-b border-slate-50">
                          <td className="py-1 pr-4">{k.name}</td>
                          <td className="py-1 pr-4 font-mono text-xs text-slate-500">{k.prefix}…</td>
                          <td className="py-1 pr-4">{k.revokedAt ? <span className="text-rose-600">Ingetrokken</span> : <span className="text-emerald-700">Actief</span>}</td>
                          <td className="py-1 pr-4 text-right">{!k.revokedAt && <button className="text-xs text-rose-600 hover:underline" onClick={() => revokeKey.mutate(k.id)}>Intrekken</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

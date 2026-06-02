import { Fragment, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useScope } from "../contexts/ScopeContext";
import { api } from "../services/api";
import { CacheBar } from "../components/CacheBar";
import { ErrorNotice } from "../components/ErrorNotice";

type DqStatus = "ok" | "warning" | "error";
interface EntityDq {
  entityId: string;
  entityName: string;
  groupName: string;
  connected: boolean;
  connectorType: string | null;
  lastSyncAt: string | null;
  dataFetchedAt: string | null;
  staleDays: number | null;
  rgsEnabled: boolean;
  accounts: number;
  mapped: number;
  unmapped: number;
  coverage: number;
  unmappedAccounts: { code: string; name: string }[];
  status: DqStatus;
  issues: string[];
}
interface DqResult {
  generatedAt: string;
  rgsEnabled: boolean;
  rows: EntityDq[];
  totals: {
    administrations: number; connected: number; accounts: number; mapped: number;
    unmapped: number; coverage: number; stale: number; withUnmapped: number; notConnected: number;
  };
  warnings: string[];
}

const STATUS_BADGE: Record<DqStatus, { label: string; cls: string }> = {
  ok: { label: "In orde", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  warning: { label: "Aandacht", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  error: { label: "Probleem", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
};
const CONNECTOR_LABEL: Record<string, string> = { YUKI: "Yuki", EBOEKHOUDEN: "e-Boekhouden", MOCK: "Mock" };

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" | "bad" }) {
  return (
    <div className="lf-card">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "bad" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : ""}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

function CoverageBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 95 ? "bg-emerald-500" : pct >= 80 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums text-xs text-slate-600">{pct}%</span>
    </div>
  );
}

const ago = (iso: string | null): string => {
  if (!iso) return "—";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins} min geleden`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} uur geleden`;
  return `${Math.floor(h / 24)} dag(en) geleden`;
};

/**
 * Data-quality dashboard: per administration the RGS mapping coverage, connector
 * sync health and data freshness, rolled up to a workspace summary, with a
 * drill-down of the still-unmapped accounts (linking to the mapping page).
 */
export function DataQualityPage() {
  const { workspace, group, entity, dateFrom, dateTo } = useScope();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const forceRef = useRef(false);
  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ["data-quality", workspace?.id, group?.id, entity?.id, dateFrom, dateTo],
    queryFn: () => {
      const f = forceRef.current;
      forceRef.current = false;
      return api<DqResult>(`/api/reporting/data-quality?from=${dateFrom}&to=${dateTo}${f ? "&refresh=1" : ""}`);
    },
    enabled: !!workspace,
  });
  const refresh = () => { forceRef.current = true; refetch(); };

  const t = data?.totals;
  const cachedAt = data?.rows.reduce<string | null>((acc, r) => (r.dataFetchedAt && (!acc || r.dataFetchedAt > acc) ? r.dataFetchedAt : acc), null) ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Datakwaliteit</h1>
        <p className="text-sm text-slate-500 mt-1">
          {group ? `Groep: ${group.name}` : `Werkruimte: ${workspace?.name ?? "—"}`} · mapping-dekking, sync-status en
          versheid per administratie
        </p>
        {workspace && <div className="mt-1"><CacheBar cachedAt={cachedAt} refreshing={isFetching} onRefresh={refresh} /></div>}
      </div>

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte in de bovenbalk.</div>}
      {workspace && isLoading && <div className="lf-card">Datakwaliteit laden…</div>}
      {isError && <ErrorNotice error={error} fallback="Kon datakwaliteit niet laden" onRetry={refresh} />}

      {data && data.warnings.length > 0 && (
        <div className="lf-card bg-amber-50 ring-amber-200 text-amber-900 text-sm space-y-1">
          {data.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
        </div>
      )}

      {t && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Tile label="RGS-dekking" value={`${Math.round(t.coverage * 100)}%`} sub={`${t.mapped} van ${t.accounts} rekeningen`} tone={t.coverage >= 0.95 ? undefined : t.coverage >= 0.8 ? "warn" : "bad"} />
          <Tile label="Administraties verbonden" value={`${t.connected}/${t.administrations}`} sub={t.notConnected ? `${t.notConnected} zonder koppeling` : "alle gekoppeld"} tone={t.notConnected ? "bad" : undefined} />
          <Tile label="Niet-gekoppelde rekeningen" value={String(t.unmapped)} sub={`in ${t.withUnmapped} administratie(s)`} tone={t.unmapped ? "warn" : undefined} />
          <Tile label="Verouderde gegevens" value={String(t.stale)} sub="administraties > 2 dagen oud" tone={t.stale ? "warn" : undefined} />
        </div>
      )}

      {data && (
        <div className="lf-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b border-slate-200 text-slate-500">
                <th className="py-1.5 pr-4">Administratie</th>
                <th className="py-1.5 pr-4">Koppeling</th>
                <th className="py-1.5 pr-4">RGS-dekking</th>
                <th className="py-1.5 pr-4 text-right">Niet gekoppeld</th>
                <th className="py-1.5 pr-4">Versheid</th>
                <th className="py-1.5 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <Fragment key={r.entityId}>
                  <tr className="border-b border-slate-50">
                    <td className="py-1.5 pr-4">
                      <div className="font-medium">{r.entityName}</div>
                      <div className="text-xs text-slate-400">{r.groupName}</div>
                    </td>
                    <td className="py-1.5 pr-4 text-slate-500">{r.connectorType ? CONNECTOR_LABEL[r.connectorType] ?? r.connectorType : "—"}</td>
                    <td className="py-1.5 pr-4">{r.connected ? <CoverageBar value={r.coverage} /> : <span className="text-slate-400">—</span>}</td>
                    <td className="py-1.5 pr-4 text-right tabular-nums">
                      {r.unmapped > 0 ? (
                        <button className="text-amber-700 hover:underline" onClick={() => toggle(r.entityId)}>
                          {r.unmapped} {open.has(r.entityId) ? "▲" : "▼"}
                        </button>
                      ) : (
                        <span className="text-slate-300">0</span>
                      )}
                    </td>
                    <td className="py-1.5 pr-4 text-slate-500">{ago(r.dataFetchedAt)}</td>
                    <td className="py-1.5 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs ring-1 ${STATUS_BADGE[r.status].cls}`}>{STATUS_BADGE[r.status].label}</span>
                      {r.issues.length > 0 && <div className="text-xs text-slate-500 mt-0.5">{r.issues.join(" · ")}</div>}
                    </td>
                  </tr>
                  {open.has(r.entityId) && r.unmappedAccounts.length > 0 && (
                    <tr className="bg-slate-50/50">
                      <td colSpan={6} className="px-4 py-2">
                        <div className="text-xs text-slate-500 mb-1">
                          Niet aan RGS gekoppelde rekeningen{r.unmapped > r.unmappedAccounts.length ? ` (eerste ${r.unmappedAccounts.length} van ${r.unmapped})` : ""} —{" "}
                          <Link to="/mappings/rgs" className="lf-link">koppel ze hier →</Link>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {r.unmappedAccounts.map((a) => (
                            <span key={a.code} className="px-2 py-0.5 rounded bg-white ring-1 ring-slate-200 text-xs">
                              <span className="font-mono text-slate-500">{a.code}</span> {a.name}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

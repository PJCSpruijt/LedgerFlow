import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { useScope } from "../contexts/ScopeContext";

type Status = "ok" | "warning" | "limited" | "unknown" | "no-connection";

interface ConnectionUsage {
  entityId: string;
  entityName: string;
  groupName: string;
  connectorType: string | null;
  callsToday: number;
  callsWindow: number;
  failedWindow: number;
  rateLimitedToday: boolean;
  lastCallAt: string | null;
  rateLimitLimit: number | null;
  rateLimitRemaining: number | null;
  rateLimitResetAt: string | null;
  status: Status;
  message: string;
}
interface UsageResult {
  days: number;
  generatedAt: string;
  connections: ConnectionUsage[];
}

const BADGE: Record<Status, { label: string; cls: string }> = {
  ok: { label: "OK", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  warning: { label: "Bijna limiet", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  limited: { label: "Daglimiet", cls: "bg-rose-50 text-rose-700 ring-rose-200" },
  unknown: { label: "Onbekend", cls: "bg-slate-50 text-slate-500 ring-slate-200" },
  "no-connection": { label: "Geen koppeling", cls: "bg-slate-50 text-slate-400 ring-slate-200" },
};

const CONNECTOR_LABEL: Record<string, string> = { YUKI: "Yuki", EBOEKHOUDEN: "e-Boekhouden", MOCK: "Mock" };

/**
 * Per-connection API usage + daily-limit visibility. Honest per connector:
 * e-Boekhouden shows the real remaining budget; Yuki only flags a daily limit
 * once it's actually hit (the SOAP API exposes no quota numbers).
 */
export function ConnectionUsagePanel() {
  const { workspace, group, entity } = useScope();
  const [days, setDays] = useState(7);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["connection-usage", workspace?.id, group?.id, entity?.id, days],
    queryFn: () => api<UsageResult>(`/api/yuki/usage?days=${days}`),
    enabled: !!workspace,
    refetchInterval: 60_000,
  });

  if (!workspace) return null;
  const rows = data?.connections.filter((c) => c.connectorType) ?? [];
  const anyWarn = rows.some((c) => c.status === "warning" || c.status === "limited");

  return (
    <div className="lf-card">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <div>
          <h2 className="text-lg font-semibold">API-verbruik & limieten</h2>
          <p className="text-xs text-slate-500">
            Verzoeken per koppeling en hoe dicht je bij de daglimiet zit. e-Boekhouden geeft het resterende budget door;
            Yuki meldt een daglimiet pas bij overschrijding.
          </p>
        </div>
        <select className="lf-input text-xs h-8 py-0 w-32" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={1}>Vandaag</option>
          <option value={7}>7 dagen</option>
          <option value={30}>30 dagen</option>
        </select>
      </div>

      {isLoading && <div className="text-sm text-slate-500">Verbruik laden…</div>}
      {isError && <div className="text-sm text-red-600">Kon API-verbruik niet laden.</div>}

      {anyWarn && (
        <div className="mb-3 text-sm rounded-md bg-amber-50 ring-1 ring-amber-200 text-amber-900 px-3 py-2">
          ⚠️ Eén of meer koppelingen naderen of bereikten de daglimiet — zie hieronder.
        </div>
      )}

      {data && rows.length === 0 && !isLoading && (
        <div className="text-sm text-slate-500">Nog geen gekoppelde administraties met API-verbruik.</div>
      )}

      {rows.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-slate-200 text-slate-500">
              <th className="py-1.5 pr-4">Administratie</th>
              <th className="py-1.5 pr-4">Koppeling</th>
              <th className="py-1.5 pr-4 text-right">Vandaag</th>
              <th className="py-1.5 pr-4 text-right">Resterend</th>
              <th className="py-1.5 pr-4 text-right">Mislukt ({days}d)</th>
              <th className="py-1.5 pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const b = BADGE[c.status];
              return (
                <tr key={c.entityId} className="border-b border-slate-50 align-top">
                  <td className="py-1.5 pr-4">{c.entityName}</td>
                  <td className="py-1.5 pr-4 text-slate-500">{CONNECTOR_LABEL[c.connectorType ?? ""] ?? c.connectorType}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">{c.callsToday}</td>
                  <td className="py-1.5 pr-4 text-right tabular-nums">
                    {c.rateLimitRemaining != null && c.rateLimitLimit != null
                      ? `${c.rateLimitRemaining} / ${c.rateLimitLimit}`
                      : "—"}
                  </td>
                  <td className={`py-1.5 pr-4 text-right tabular-nums ${c.failedWindow > 0 ? "text-rose-600" : "text-slate-400"}`}>
                    {c.failedWindow}
                  </td>
                  <td className="py-1.5 pr-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs ring-1 ${b.cls}`}>{b.label}</span>
                    <div className="text-xs text-slate-500 mt-0.5 max-w-md">{c.message}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";

const STATUSES = ["NEW", "ACKNOWLEDGED", "INVESTIGATING", "FIX_IN_PROGRESS", "DEPLOYED", "RESOLVED", "CLOSED"] as const;
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
type Status = (typeof STATUSES)[number];
type Severity = (typeof SEVERITIES)[number];

const STATUS_LABEL: Record<Status, string> = {
  NEW: "Nieuw", ACKNOWLEDGED: "Bevestigd", INVESTIGATING: "In onderzoek",
  FIX_IN_PROGRESS: "Fix in uitvoering", DEPLOYED: "Uitgerold", RESOLVED: "Opgelost", CLOSED: "Gesloten",
};
const STATUS_CLS: Record<Status, string> = {
  NEW: "bg-rose-50 text-rose-700 ring-rose-200",
  ACKNOWLEDGED: "bg-amber-50 text-amber-800 ring-amber-200",
  INVESTIGATING: "bg-amber-50 text-amber-800 ring-amber-200",
  FIX_IN_PROGRESS: "bg-blue-50 text-blue-700 ring-blue-200",
  DEPLOYED: "bg-blue-50 text-blue-700 ring-blue-200",
  RESOLVED: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  CLOSED: "bg-slate-50 text-slate-500 ring-slate-200",
};
const SEV_LABEL: Record<Severity, string> = { LOW: "Laag", MEDIUM: "Normaal", HIGH: "Hoog", CRITICAL: "Kritiek" };
const SEV_CLS: Record<Severity, string> = {
  LOW: "bg-slate-50 text-slate-500 ring-slate-200",
  MEDIUM: "bg-slate-100 text-slate-700 ring-slate-300",
  HIGH: "bg-orange-50 text-orange-700 ring-orange-200",
  CRITICAL: "bg-rose-50 text-rose-700 ring-rose-200",
};

interface Incident {
  id: string; title: string; severity: string; status: string; route: string | null; module: string | null;
  occurrenceCount: number; reporterCount: number; workspaceId: string | null; firstSeenAt: string; lastSeenAt: string;
}
interface IncidentDetail extends Incident {
  description: string | null; resolution: string | null; context: unknown;
  events: { id: string; kind: string; userId: string | null; message: string | null; createdAt: string }[];
}

const ago = (iso: string) => {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}u`;
  return `${Math.floor(m / 1440)}d`;
};

export function AdminIncidentsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<Status | "">("");
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["incidents", status],
    queryFn: () => api<{ incidents: Incident[]; counts: Record<string, number> }>(`/api/incidents${status ? `?status=${status}` : ""}`),
  });
  const detailQ = useQuery({
    queryKey: ["incident", selected],
    queryFn: () => api<{ incident: IncidentDetail }>(`/api/incidents/${selected}`),
    enabled: !!selected,
  });

  const patchMut = useMutation({
    mutationFn: (b: { status?: Status; severity?: Severity; note?: string; resolution?: string }) =>
      api(`/api/incidents/${selected}`, { method: "PATCH", body: b }),
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["incidents"] });
      qc.invalidateQueries({ queryKey: ["incident", selected] });
    },
  });

  const inc = detailQ.data?.incident;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Incidenten</h1>
        <p className="text-sm text-slate-500 mt-1">Centrale probleemmeldingen, gededupliceerd op fingerprint. Triage en statusbeheer.</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap text-sm">
        <button className={`px-3 py-1 rounded-full ring-1 ${status === "" ? "bg-slate-800 text-white ring-slate-800" : "ring-slate-200 text-slate-600"}`} onClick={() => setStatus("")}>
          Alle ({Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0)})
        </button>
        {STATUSES.map((s) => (
          <button key={s} className={`px-3 py-1 rounded-full ring-1 ${status === s ? "bg-slate-800 text-white ring-slate-800" : "ring-slate-200 text-slate-600"}`} onClick={() => setStatus(s)}>
            {STATUS_LABEL[s]} ({data?.counts[s] ?? 0})
          </button>
        ))}
      </div>

      {isLoading && <div className="lf-card">Incidenten laden…</div>}

      {data && (
        <div className="lf-card p-0 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr className="border-b border-slate-200">
                <th className="py-2 px-3 font-medium">Probleem</th>
                <th className="py-2 px-3 font-medium">Urgentie</th>
                <th className="py-2 px-3 font-medium">Status</th>
                <th className="py-2 px-3 font-medium">Locatie</th>
                <th className="py-2 px-3 font-medium text-right">Meldingen</th>
                <th className="py-2 px-3 font-medium text-right">Laatst</th>
              </tr>
            </thead>
            <tbody>
              {data.incidents.length === 0 && (
                <tr><td colSpan={6} className="py-4 px-3 text-center text-slate-400">Geen incidenten.</td></tr>
              )}
              {data.incidents.map((i) => (
                <tr key={i.id} className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${selected === i.id ? "bg-brand-50" : ""}`} onClick={() => setSelected(i.id)}>
                  <td className="py-1.5 px-3">{i.title}</td>
                  <td className="py-1.5 px-3"><span className={`px-2 py-0.5 rounded-full text-xs ring-1 ${SEV_CLS[i.severity as Severity]}`}>{SEV_LABEL[i.severity as Severity]}</span></td>
                  <td className="py-1.5 px-3"><span className={`px-2 py-0.5 rounded-full text-xs ring-1 ${STATUS_CLS[i.status as Status]}`}>{STATUS_LABEL[i.status as Status]}</span></td>
                  <td className="py-1.5 px-3 text-xs text-slate-500 font-mono">{i.route ?? i.module ?? "—"}</td>
                  <td className="py-1.5 px-3 text-right tabular-nums">{i.occurrenceCount}{i.reporterCount > 1 ? ` · ${i.reporterCount} melders` : ""}</td>
                  <td className="py-1.5 px-3 text-right text-slate-500">{ago(i.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {inc && (
        <div className="lf-card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{inc.title}</h2>
              <p className="text-xs text-slate-500 font-mono">{inc.route ?? "—"} · module {inc.module ?? "—"} · {inc.occurrenceCount} melding(en)</p>
            </div>
            <button className="text-sm text-slate-400" onClick={() => setSelected(null)}>✕</button>
          </div>
          {inc.description && <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap">{inc.description}</p>}

          <div className="flex items-end gap-2 flex-wrap mt-3 pt-3 border-t border-slate-100">
            <label className="text-xs text-slate-500">Status
              <select className="lf-input h-9 text-sm w-44 block mt-0.5" value={inc.status} onChange={(e) => patchMut.mutate({ status: e.target.value as Status })}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </label>
            <label className="text-xs text-slate-500">Urgentie
              <select className="lf-input h-9 text-sm w-36 block mt-0.5" value={inc.severity} onChange={(e) => patchMut.mutate({ severity: e.target.value as Severity })}>
                {SEVERITIES.map((s) => <option key={s} value={s}>{SEV_LABEL[s]}</option>)}
              </select>
            </label>
            <input className="lf-input h-9 text-sm flex-1 min-w-[12rem]" placeholder="Interne notitie toevoegen…" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="lf-btn-secondary text-sm h-9" disabled={!note.trim() || patchMut.isPending} onClick={() => patchMut.mutate({ note: note.trim() })}>Notitie</button>
          </div>

          <div className="mt-4">
            <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1">Tijdlijn</h3>
            <ul className="space-y-1 text-sm">
              {inc.events.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="text-xs text-slate-400 w-28 shrink-0">{new Date(e.createdAt).toLocaleString("nl-NL")}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 h-fit">{e.kind}</span>
                  <span className="text-slate-700">{e.message ?? "—"}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { api } from "../services/api";
import { STATUS_LABEL, CATEGORY_LABEL } from "./labsShared";

interface IdeaItem { id: string; title: string; category: string; status: string; voteCount: number; commentCount: number }

const COLUMNS: { status: string; accent: string }[] = [
  { status: "PLANNED", accent: "border-blue-300" },
  { status: "IN_PROGRESS", accent: "border-violet-300" },
  { status: "BETA", accent: "border-cyan-300" },
  { status: "RELEASED", accent: "border-emerald-300" },
];

/** Public roadmap: ideas grouped into the build pipeline columns. */
export function LabsRoadmapPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["labs-roadmap"],
    queryFn: () => api<{ ideas: IdeaItem[]; counts: Record<string, number> }>("/api/labs/ideas?sort=top"),
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Roadmap</h1>
        <p className="text-sm text-slate-500 mt-1">Wat er gepland staat, in ontwikkeling is, in bèta of net uitgebracht.</p>
      </div>

      {isLoading && <div className="lf-card">Roadmap laden…</div>}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {COLUMNS.map((col) => {
            const items = data.ideas.filter((i) => i.status === col.status);
            return (
              <div key={col.status} className="space-y-2">
                <div className={`text-sm font-semibold pb-1 border-b-2 ${col.accent}`}>
                  {STATUS_LABEL[col.status]} <span className="text-slate-400 font-normal">({items.length})</span>
                </div>
                {items.length === 0 && <div className="text-xs text-slate-400 py-2">Niets hier.</div>}
                {items.map((i) => (
                  <div key={i.id} className="lf-card p-3">
                    <div className="text-sm font-medium">{i.title}</div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                      <span>{CATEGORY_LABEL[i.category] ?? i.category}</span>
                      <span>▲ {i.voteCount}</span>
                      <span>💬 {i.commentCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

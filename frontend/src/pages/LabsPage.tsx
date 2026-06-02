import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { LAB_CATEGORIES, LAB_STATUSES, STATUS_LABEL, STATUS_CLS, CATEGORY_LABEL } from "./labsShared";

interface IdeaItem { id: string; title: string; category: string; status: string; voteCount: number; commentCount: number; hasVoted: boolean; createdAt: string }
interface Detail { id: string; title: string; description: string; category: string; status: string; voteCount: number; hasVoted: boolean; createdAt: string; comments: { id: string; userId: string | null; body: string; createdAt: string }[] }
interface Similar { id: string; title: string; voteCount: number; status: string }

function VoteButton({ count, voted, onClick, busy }: { count: number; voted: boolean; onClick: () => void; busy: boolean }) {
  return (
    <button
      className={`flex flex-col items-center justify-center w-12 h-12 rounded-lg ring-1 shrink-0 ${voted ? "bg-brand-50 text-brand-700 ring-brand-300" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50"}`}
      disabled={busy}
      onClick={onClick}
      title={voted ? "Stem intrekken" : "Stemmen"}
    >
      <span className="text-xs leading-none">▲</span>
      <span className="text-sm font-semibold tabular-nums">{count}</span>
    </button>
  );
}

export function LabsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.platformRole === "PLATFORM_ADMIN";
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<"top" | "new">("top");
  const [selected, setSelected] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [cat, setCat] = useState("OTHER");
  const [comment, setComment] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["labs-ideas", status, sort],
    queryFn: () => api<{ ideas: IdeaItem[]; counts: Record<string, number> }>(`/api/labs/ideas?sort=${sort}${status ? `&status=${status}` : ""}`),
  });
  const similarQ = useQuery({
    queryKey: ["labs-similar", title],
    queryFn: () => api<{ similar: Similar[] }>(`/api/labs/ideas/similar?title=${encodeURIComponent(title)}`),
    enabled: showForm && title.trim().length >= 4,
  });
  const detailQ = useQuery({
    queryKey: ["labs-idea", selected],
    queryFn: () => api<{ idea: Detail }>(`/api/labs/ideas/${selected}`),
    enabled: !!selected,
  });

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["labs-ideas"] }); if (selected) qc.invalidateQueries({ queryKey: ["labs-idea", selected] }); };
  const voteMut = useMutation({ mutationFn: (id: string) => api(`/api/labs/ideas/${id}/vote`, { method: "POST" }), onSuccess: invalidate });
  const createMut = useMutation({
    mutationFn: () => api<{ id: string }>("/api/labs/ideas", { method: "POST", body: { title: title.trim(), description: desc.trim(), category: cat } }),
    onSuccess: (r) => { setShowForm(false); setTitle(""); setDesc(""); setCat("OTHER"); setSelected(r.id); invalidate(); },
  });
  const commentMut = useMutation({
    mutationFn: (b: { id: string; body: string }) => api(`/api/labs/ideas/${b.id}/comments`, { method: "POST", body: { body: b.body } }),
    onSuccess: () => { setComment(""); if (selected) qc.invalidateQueries({ queryKey: ["labs-idea", selected] }); },
  });
  const statusMut = useMutation({
    mutationFn: (b: { id: string; status: string }) => api(`/api/labs/ideas/${b.id}`, { method: "PATCH", body: { status: b.status } }),
    onSuccess: invalidate,
  });

  const idea = detailQ.data?.idea;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">FIN//HUB Labs</h1>
          <p className="text-sm text-slate-500 mt-1">Deel ideeën, stem op wat jij belangrijk vindt en volg wat we bouwen.</p>
        </div>
        <button className="lf-btn-primary text-sm" onClick={() => setShowForm((v) => !v)}>{showForm ? "Annuleren" : "💡 Idee indienen"}</button>
      </div>

      {showForm && (
        <div className="lf-card max-w-2xl space-y-2">
          <input className="lf-input w-full text-sm" placeholder="Korte titel van je idee" value={title} onChange={(e) => setTitle(e.target.value)} />
          {similarQ.data && similarQ.data.similar.length > 0 && (
            <div className="text-xs bg-amber-50 ring-1 ring-amber-200 rounded p-2">
              <div className="text-amber-800 mb-1">Lijkt dit op een bestaand idee? Stem mee in plaats van een duplicaat aan te maken:</div>
              <ul className="space-y-0.5">
                {similarQ.data.similar.map((s) => (
                  <li key={s.id}>
                    <button className="lf-link" onClick={() => { setShowForm(false); setSelected(s.id); }}>“{s.title}” ({s.voteCount} stemmen)</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <textarea className="lf-input w-full text-sm h-24" placeholder="Beschrijf je idee en waarom het helpt" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <div className="flex items-center gap-2">
            <select className="lf-input text-sm h-9 w-48" value={cat} onChange={(e) => setCat(e.target.value)}>
              {LAB_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
            </select>
            <button className="lf-btn-primary text-sm h-9" disabled={createMut.isPending || title.trim().length < 4 || !desc.trim()} onClick={() => createMut.mutate()}>Indienen</button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap text-sm">
        <button className={`px-3 py-1 rounded-full ring-1 ${status === "" ? "bg-slate-800 text-white ring-slate-800" : "ring-slate-200 text-slate-600"}`} onClick={() => setStatus("")}>Alle</button>
        {LAB_STATUSES.filter((s) => !["DECLINED", "DUPLICATE"].includes(s)).map((s) => (
          <button key={s} className={`px-3 py-1 rounded-full ring-1 ${status === s ? "bg-slate-800 text-white ring-slate-800" : "ring-slate-200 text-slate-600"}`} onClick={() => setStatus(s)}>
            {STATUS_LABEL[s]} ({data?.counts[s] ?? 0})
          </button>
        ))}
        <span className="flex-1" />
        <select className="lf-input text-xs h-8 w-32" value={sort} onChange={(e) => setSort(e.target.value as "top" | "new")}>
          <option value="top">Meeste stemmen</option>
          <option value="new">Nieuwste</option>
        </select>
      </div>

      {isLoading && <div className="lf-card">Ideeën laden…</div>}
      {data && data.ideas.length === 0 && <div className="lf-card text-sm text-slate-400">Nog geen ideeën — dien het eerste in!</div>}

      <div className="space-y-2">
        {data?.ideas.map((i) => (
          <div key={i.id} className="lf-card flex items-start gap-3">
            <VoteButton count={i.voteCount} voted={i.hasVoted} busy={voteMut.isPending} onClick={() => voteMut.mutate(i.id)} />
            <div className="flex-1 min-w-0">
              <button className="text-left font-medium hover:underline" onClick={() => setSelected(i.id)}>{i.title}</button>
              <div className="flex items-center gap-2 mt-1 text-xs">
                <span className="text-slate-500">{CATEGORY_LABEL[i.category] ?? i.category}</span>
                <span className={`px-2 py-0.5 rounded-full ring-1 ${STATUS_CLS[i.status]}`}>{STATUS_LABEL[i.status]}</span>
                <span className="text-slate-400">💬 {i.commentCount}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {idea && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={() => setSelected(null)}>
          <div className="bg-white w-full max-w-lg h-full overflow-auto p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <VoteButton count={idea.voteCount} voted={idea.hasVoted} busy={voteMut.isPending} onClick={() => voteMut.mutate(idea.id)} />
                <div>
                  <h2 className="text-lg font-semibold">{idea.title}</h2>
                  <div className="flex items-center gap-2 mt-1 text-xs">
                    <span className="text-slate-500">{CATEGORY_LABEL[idea.category] ?? idea.category}</span>
                    <span className={`px-2 py-0.5 rounded-full ring-1 ${STATUS_CLS[idea.status]}`}>{STATUS_LABEL[idea.status]}</span>
                  </div>
                </div>
              </div>
              <button className="text-slate-400" onClick={() => setSelected(null)}>✕</button>
            </div>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{idea.description}</p>

            {isAdmin && (
              <div className="pt-2 border-t border-slate-100">
                <label className="text-xs text-slate-500">Status (platformbeheer)
                  <select className="lf-input h-9 text-sm w-48 block mt-0.5" value={idea.status} onChange={(e) => statusMut.mutate({ id: idea.id, status: e.target.value })}>
                    {LAB_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </select>
                </label>
              </div>
            )}

            <div className="pt-2 border-t border-slate-100">
              <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-2">Reacties ({idea.comments.length})</h3>
              <ul className="space-y-2 mb-3">
                {idea.comments.map((c) => (
                  <li key={c.id} className="text-sm">
                    <div className="text-slate-700 whitespace-pre-wrap">{c.body}</div>
                    <div className="text-xs text-slate-400">{new Date(c.createdAt).toLocaleString("nl-NL")}</div>
                  </li>
                ))}
                {idea.comments.length === 0 && <li className="text-sm text-slate-400">Nog geen reacties.</li>}
              </ul>
              <div className="flex gap-2">
                <input className="lf-input text-sm flex-1" placeholder="Reageer…" value={comment} onChange={(e) => setComment(e.target.value)} />
                <button className="lf-btn-primary text-sm" disabled={!comment.trim() || commentMut.isPending} onClick={() => commentMut.mutate({ id: idea.id, body: comment.trim() })}>Plaats</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

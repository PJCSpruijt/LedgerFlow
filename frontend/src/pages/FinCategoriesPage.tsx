import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../services/api";
import { isAdminRole, useScope } from "../contexts/ScopeContext";

interface FinCategory {
  id: string;
  workspaceId: string | null;
  key: string;
  label: string;
  kind: "REVENUE" | "COST" | "METRIC";
  description: string | null;
  sortOrder: number;
}

const KINDS: FinCategory["kind"][] = ["REVENUE", "COST", "METRIC"];
const KIND_LABEL: Record<FinCategory["kind"], string> = {
  REVENUE: "Opbrengst",
  COST: "Kosten",
  METRIC: "Metric",
};

/**
 * Toewijzingen → FIN-categorieën: manage the FIN//HUB semantic categories that
 * sit on top of RGS (MRR/ARR/EBITDA/…). Platform defaults are read-only; a
 * workspace can add/edit/remove its own.
 */
export function FinCategoriesPage() {
  const { workspace } = useScope();
  const canEdit = isAdminRole(workspace?.role);
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState({ key: "", label: "", kind: "METRIC" as FinCategory["kind"], description: "" });

  const queryKey = ["fin-categories", workspace?.id];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => api<{ categories: FinCategory[] }>("/api/rgs-mappings/fin-categories"),
    enabled: !!workspace,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });
  const onErr = (e: unknown) => setErr(e instanceof ApiError ? e.message : "Actie mislukt");

  const create = useMutation({
    mutationFn: (body: typeof form) => api("/api/rgs-mappings/fin-categories", { method: "POST", body }),
    onSuccess: () => {
      setForm({ key: "", label: "", kind: "METRIC", description: "" });
      invalidate();
    },
    onError: onErr,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; patch: Partial<FinCategory> }) =>
      api(`/api/rgs-mappings/fin-categories/${v.id}`, { method: "PATCH", body: v.patch }),
    onSuccess: invalidate,
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/rgs-mappings/fin-categories/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: onErr,
  });

  if (!workspace) return <div className="lf-card max-w-2xl">Selecteer een werkruimte.</div>;

  const cats = data?.categories ?? [];
  const defaults = cats.filter((c) => c.workspaceId === null);
  const own = cats.filter((c) => c.workspaceId !== null);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">FIN-categorieën</h1>
        <p className="text-sm text-slate-500 mt-1">
          De semantische categorieën van FIN//HUB (bovenop RGS) — denk aan MRR, ARR, EBITDA. Je kent
          ze toe aan bronrekeningen op{" "}
          <span className="font-medium">Rekeningkoppelingen (RGS)</span>. De standaardcategorieën zijn
          vast; eigen categorieën beheer je hier.
        </p>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}
      {isLoading && <div className="lf-card">Laden…</div>}

      {canEdit && (
        <div className="lf-card space-y-3">
          <h2 className="text-lg font-semibold">Eigen categorie toevoegen</h2>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="lf-label">Sleutel</label>
              <input
                className="lf-input font-mono w-36"
                placeholder="GROSS_MARGIN"
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
              />
            </div>
            <div>
              <label className="lf-label">Naam</label>
              <input
                className="lf-input w-48"
                placeholder="Gross margin"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>
            <div>
              <label className="lf-label">Soort</label>
              <select
                className="lf-input"
                value={form.kind}
                onChange={(e) => setForm({ ...form, kind: e.target.value as FinCategory["kind"] })}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="lf-btn-primary"
              disabled={!form.key.trim() || !form.label.trim() || create.isPending}
              onClick={() => create.mutate(form)}
            >
              Toevoegen
            </button>
          </div>
        </div>
      )}

      <div className="lf-card p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2 px-3 font-medium">Sleutel</th>
              <th className="py-2 px-3 font-medium">Naam</th>
              <th className="py-2 px-3 font-medium">Soort</th>
              <th className="py-2 px-3 font-medium">Herkomst</th>
              <th className="py-2 px-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {defaults.map((c) => (
              <tr key={c.id} className="border-b border-slate-100">
                <td className="py-2 px-3 font-mono">{c.key}</td>
                <td className="py-2 px-3">{c.label}</td>
                <td className="py-2 px-3 text-slate-500">{KIND_LABEL[c.kind]}</td>
                <td className="py-2 px-3">
                  <span className="lf-pill bg-slate-100 text-slate-600">Standaard</span>
                </td>
                <td className="py-2 px-3" />
              </tr>
            ))}
            {own.map((c) => (
              <tr key={c.id} className="border-b border-slate-100">
                <td className="py-2 px-3 font-mono">{c.key}</td>
                <td className="py-2 px-3">
                  {canEdit ? (
                    <input
                      className="lf-input h-8 py-0 w-44"
                      defaultValue={c.label}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== c.label) update.mutate({ id: c.id, patch: { label: v } });
                      }}
                    />
                  ) : (
                    c.label
                  )}
                </td>
                <td className="py-2 px-3">
                  {canEdit ? (
                    <select
                      className="lf-input h-8 py-0"
                      value={c.kind}
                      onChange={(e) => update.mutate({ id: c.id, patch: { kind: e.target.value as FinCategory["kind"] } })}
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                  ) : (
                    KIND_LABEL[c.kind]
                  )}
                </td>
                <td className="py-2 px-3">
                  <span className="lf-pill bg-blue-100 text-blue-800">Eigen</span>
                </td>
                <td className="py-2 px-3 text-right">
                  {canEdit && (
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => {
                        if (window.confirm(`Categorie "${c.label}" verwijderen? Koppelingen blijven bestaan, de FIN-categorie wordt er afgehaald.`))
                          remove.mutate(c.id);
                      }}
                    >
                      Verwijderen
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {cats.length === 0 && !isLoading && (
              <tr>
                <td colSpan={5} className="py-3 px-3 text-slate-400">
                  Nog geen categorieën.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

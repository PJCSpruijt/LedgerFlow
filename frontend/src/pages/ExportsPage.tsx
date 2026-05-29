import { useEffect, useMemo, useState } from "react";
import { api, apiDownload, ApiError } from "../services/api";
import { useScope } from "../contexts/ScopeContext";

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  return { from: `${year}-01-01`, to: now.toISOString().slice(0, 10) };
}

export function ExportsPage() {
  const { workspace } = useScope();
  const [range, setRange] = useState(defaultRange());
  const [busy, setBusy] = useState<"tb" | "tx" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Every administration across all groups in the current workspace.
  const entities = useMemo(
    () => workspace?.groups.flatMap((g) => g.entities) ?? [],
    [workspace],
  );

  useEffect(() => {
    if (!workspace) return;
    void (async () => {
      try {
        const r = await api<{ subscription: { status: string } | null }>(
          "/api/billing/subscription",
        );
        setStatus(r.subscription?.status ?? null);
      } catch {
        setStatus(null);
      }
    })();
  }, [workspace?.id]);

  // Default to the whole workspace whenever the workspace (and its entities) change.
  useEffect(() => {
    setSelected(new Set(entities.map((e) => e.id)));
  }, [workspace?.id, entities.length]);

  if (!workspace) {
    return <div className="lf-card max-w-2xl">Selecteer een werkruimte in de zijbalk.</div>;
  }
  if (entities.length === 0) {
    return (
      <div className="lf-card max-w-2xl">
        Deze werkruimte heeft nog geen administraties. Voeg er een toe in de zijbalk.
      </div>
    );
  }

  const active = status === "ACTIVE" || status === "TRIALING";
  const allSelected = selected.size === entities.length;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(entities.map((e) => e.id)));
  };

  const download = async (kind: "tb" | "tx") => {
    setErr(null);
    setBusy(kind);
    try {
      const path = kind === "tb" ? "trial-balance.xlsx" : "transactions.xlsx";
      const filename =
        kind === "tb"
          ? `ledgerflow-proefbalans-${range.from}_${range.to}.xlsx`
          : `ledgerflow-mutaties-${range.from}_${range.to}.xlsx`;
      const params = new URLSearchParams(range);
      // Omit entityIds when the whole workspace is selected — the backend treats
      // an absent list as "every administration the caller may access".
      if (!allSelected) params.set("entityIds", [...selected].join(","));
      await apiDownload(`/api/export/${path}?${params.toString()}`, filename);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Download mislukt");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Excel-exports</h1>
        <p className="text-sm text-slate-500 mt-1">
          Genereer professionele werkmappen vanuit je Yuki-administraties.
        </p>
      </div>

      {!active && (
        <div className="lf-card bg-amber-50 ring-amber-200 text-amber-900">
          Exports vereisen een actief abonnement. Activeer een plan in <strong>Abonnement</strong>.
        </div>
      )}

      <div className="lf-card max-w-2xl space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="lf-label">Periode van</label>
            <input
              type="date"
              className="lf-input"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </div>
          <div>
            <label className="lf-label">Periode tot</label>
            <input
              type="date"
              className="lf-input"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className="lf-label">Administraties</label>
          <div className="mt-1 rounded-md border border-slate-200 divide-y divide-slate-100">
            <label className="flex items-center gap-2 px-3 py-2 text-sm font-medium cursor-pointer">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Hele werkruimte ({entities.length})
            </label>
            {entities.map((e) => (
              <label
                key={e.id}
                className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selected.has(e.id)}
                  onChange={() => toggle(e.id)}
                />
                {e.name}
              </label>
            ))}
          </div>
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        <div className="flex gap-3">
          <button
            className="lf-btn-primary"
            disabled={!active || busy !== null || selected.size === 0}
            onClick={() => download("tb")}
          >
            {busy === "tb" ? "Genereren…" : "Download proefbalans.xlsx"}
          </button>
          <button
            className="lf-btn-secondary"
            disabled={!active || busy !== null || selected.size === 0}
            onClick={() => download("tx")}
          >
            {busy === "tx" ? "Genereren…" : "Download mutaties.xlsx"}
          </button>
        </div>
      </div>
    </div>
  );
}

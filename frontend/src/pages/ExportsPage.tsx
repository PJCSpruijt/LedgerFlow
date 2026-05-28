import { useEffect, useState } from "react";
import { api, apiDownload, ApiError } from "../services/api";
import { useScope } from "../contexts/ScopeContext";

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const year = now.getFullYear();
  return { from: `${year}-01-01`, to: now.toISOString().slice(0, 10) };
}

export function ExportsPage() {
  const { workspace, entity } = useScope();
  const [range, setRange] = useState(defaultRange());
  const [busy, setBusy] = useState<"tb" | "tx" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

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

  if (!entity) return <div className="lf-card max-w-2xl">Selecteer een administratie in de zijbalk.</div>;

  const active = status === "ACTIVE" || status === "TRIALING";

  const download = async (kind: "tb" | "tx") => {
    setErr(null);
    setBusy(kind);
    try {
      const path = kind === "tb" ? "trial-balance.xlsx" : "transactions.xlsx";
      const filename =
        kind === "tb"
          ? `ledgerflow-proefbalans-${range.from}_${range.to}.xlsx`
          : `ledgerflow-mutaties-${range.from}_${range.to}.xlsx`;
      const qs = new URLSearchParams(range).toString();
      await apiDownload(`/api/export/${path}?${qs}`, filename);
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
          Genereer professionele werkmappen vanuit je Yuki-administratie.
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

        {err && <div className="text-sm text-red-600">{err}</div>}

        <div className="flex gap-3">
          <button
            className="lf-btn-primary"
            disabled={!active || busy !== null}
            onClick={() => download("tb")}
          >
            {busy === "tb" ? "Genereren…" : "Download proefbalans.xlsx"}
          </button>
          <button
            className="lf-btn-secondary"
            disabled={!active || busy !== null}
            onClick={() => download("tx")}
          >
            {busy === "tx" ? "Genereren…" : "Download mutaties.xlsx"}
          </button>
        </div>
      </div>
    </div>
  );
}

import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api } from "../services/api";

interface Subscription {
  plan: string | null;
  planName?: string | null;
  status: string;
  validUntil: string | null;
}

function StatusPill({ status }: { status: string | undefined | null }) {
  const map: Record<string, string> = {
    ACTIVE: "bg-emerald-100 text-emerald-800",
    TRIALING: "bg-blue-100 text-blue-800",
    PAST_DUE: "bg-amber-100 text-amber-800",
    CANCELED: "bg-slate-200 text-slate-700",
    NONE: "bg-slate-200 text-slate-700",
  };
  const label =
    status === "ACTIVE"
      ? "Actief"
      : status === "TRIALING"
        ? "Proefperiode"
        : status === "PAST_DUE"
          ? "Betaling vereist"
          : status === "CANCELED"
            ? "Beëindigd"
            : "Geen abonnement";
  return <span className={`lf-pill ${map[status ?? "NONE"] ?? map.NONE}`}>{label}</span>;
}

export function DashboardPage() {
  const { workspace, entity } = useScope();

  const { data: subResp } = useQuery({
    queryKey: ["billing-subscription", workspace?.id],
    queryFn: () => api<{ subscription: Subscription | null }>("/api/billing/subscription"),
    enabled: !!workspace,
  });
  const sub = subResp?.subscription ?? null;

  const { data: connResp } = useQuery({
    queryKey: ["connection", entity?.id],
    queryFn: () => api<{ connection: unknown | null }>("/api/yuki/connection"),
    enabled: !!entity,
  });
  const connected = connResp?.connection != null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          {entity
            ? `Overzicht voor ${entity.name}`
            : workspace
              ? `Overzicht voor ${workspace.name}`
              : "Selecteer een werkruimte"}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="lf-card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Boekhoudkoppeling</div>
          <div className="mt-2 text-lg font-semibold">
            {!entity ? "Selecteer een administratie" : connected ? "Verbonden" : "Nog niet ingesteld"}
          </div>
          <Link to="/data/connectors" className="lf-link text-sm mt-3 inline-block">
            Naar koppeling →
          </Link>
        </div>

        <div className="lf-card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Abonnement</div>
          <div className="mt-2 flex items-center gap-2">
            <StatusPill status={sub?.status} />
            {(sub?.planName ?? sub?.plan) && (
              <span className="text-sm text-slate-500">{sub?.planName ?? sub?.plan}</span>
            )}
          </div>
          {sub?.validUntil && (
            <div className="text-xs text-slate-500 mt-2">
              Geldig tot {new Date(sub.validUntil).toLocaleDateString("nl-NL")}
            </div>
          )}
          <Link to="/administration/billing" className="lf-link text-sm mt-3 inline-block">
            Beheer abonnement →
          </Link>
        </div>

        <div className="lf-card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Snelle export</div>
          <div className="mt-2 text-sm text-slate-700">
            Genereer een proefbalans of mutatieoverzicht in Excel.
          </div>
          <Link to="/reporting/downloads" className="lf-btn-primary mt-3 inline-block">
            Naar exports
          </Link>
        </div>
      </div>

      <div className="lf-card">
        <h2 className="text-lg font-semibold mb-2">Aan de slag</h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700">
          <li>
            <Link to="/data/connectors" className="lf-link">
              Koppel een boekhouding
            </Link>{" "}
            (Yuki of e-Boekhouden) aan deze administratie.
          </li>
          <li>
            <Link to="/administration/billing" className="lf-link">
              Activeer een abonnement
            </Link>{" "}
            om premium-functies (syncs, exports) te ontgrendelen.
          </li>
          <li>
            <Link to="/reporting/downloads" className="lf-link">
              Download een Excel-export
            </Link>{" "}
            voor je administratie.
          </li>
        </ol>
      </div>
    </div>
  );
}

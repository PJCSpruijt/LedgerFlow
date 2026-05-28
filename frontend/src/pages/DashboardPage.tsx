import { Link } from "react-router-dom";
import { useOrg } from "../contexts/OrganizationContext";

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
  return (
    <span className={`lf-pill ${map[status ?? "NONE"] ?? map.NONE}`}>{label}</span>
  );
}

export function DashboardPage() {
  const { current } = useOrg();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-1">
          {current ? `Overzicht voor ${current.name}` : "Selecteer een organisatie"}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="lf-card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Yuki-koppeling</div>
          <div className="mt-2 text-lg font-semibold">
            {current?.hasYukiConnection ? "Verbonden" : "Nog niet ingesteld"}
          </div>
          <Link to="/yuki" className="lf-link text-sm mt-3 inline-block">
            Naar instellingen →
          </Link>
        </div>

        <div className="lf-card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Abonnement</div>
          <div className="mt-2 flex items-center gap-2">
            <StatusPill status={current?.subscription?.status} />
            {current?.subscription?.plan && (
              <span className="text-sm text-slate-500">{current.subscription.plan}</span>
            )}
          </div>
          {current?.subscription?.validUntil && (
            <div className="text-xs text-slate-500 mt-2">
              Geldig tot {new Date(current.subscription.validUntil).toLocaleDateString("nl-NL")}
            </div>
          )}
          <Link to="/billing" className="lf-link text-sm mt-3 inline-block">
            Beheer abonnement →
          </Link>
        </div>

        <div className="lf-card">
          <div className="text-xs uppercase tracking-wide text-slate-500">Snelle export</div>
          <div className="mt-2 text-sm text-slate-700">
            Genereer een proefbalans of mutatieoverzicht in Excel.
          </div>
          <Link to="/exports" className="lf-btn-primary mt-3 inline-block">
            Naar exports
          </Link>
        </div>
      </div>

      <div className="lf-card">
        <h2 className="text-lg font-semibold mb-2">Aan de slag</h2>
        <ol className="list-decimal pl-5 space-y-2 text-sm text-slate-700">
          <li>
            <Link to="/yuki" className="lf-link">
              Koppel je Yuki-domein
            </Link>{" "}
            met een Web service API-key en Administration ID.
          </li>
          <li>
            <Link to="/billing" className="lf-link">
              Activeer een abonnement
            </Link>{" "}
            om premium-functies (syncs, exports) te ontgrendelen.
          </li>
          <li>
            <Link to="/exports" className="lf-link">
              Download een Excel-export
            </Link>{" "}
            voor je administratie.
          </li>
        </ol>
      </div>
    </div>
  );
}

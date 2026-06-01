import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";
import { formatMoney } from "../lib/period";
import { isWidgetEnabled } from "../lib/dashboardWidgets";

interface Subscription {
  plan: string | null;
  planName?: string | null;
  status: string;
  validUntil: string | null;
}

interface MonthRevenue {
  month: number; // 1-12
  current: number;
  currentGross: number;
  currentIc: number;
  previous: number;
}
interface Kpis {
  from: string;
  to: string;
  currency: string;
  entities: { id: string; name: string; included: boolean; reason?: string }[];
  revenueByMonth: MonthRevenue[];
  revenueYear: number;
  revenuePrevYear: number;
  revenueTotal: { gross: number; intercompany: number; net: number };
  revenuePrevTotal: number;
  unmappedRgsAccounts: number;
  unmappedVatCodes: number;
  cash: number;
  workingCapital: {
    net: number;
    receivables: number;
    payables: number;
    receivablesGross: number;
    payablesGross: number;
    intercompanyReceivables: number;
    intercompanyPayables: number;
  };
  outstandingDebtors: { gross: number; intercompany: number; net: number };
  outstandingCreditors: { gross: number; intercompany: number; net: number };
  intercompanyConfigured: boolean;
  warnings: string[];
}

const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** A single KPI tile: big net value + optional gross/intercompany subtext. */
function KpiTile({
  label,
  value,
  currency,
  gross,
  intercompany,
  icLabel,
  to,
}: {
  label: string;
  value: number;
  currency: string;
  gross?: number;
  intercompany?: number;
  icLabel?: string;
  to?: string;
}) {
  const body = (
    <>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(value, currency)}</div>
      {intercompany != null && Math.abs(intercompany) > 0.005 && (
        <div className="mt-1 text-xs text-slate-500">
          bruto {formatMoney(gross ?? 0, currency)} ·{" "}
          <span className="text-rose-600">−{formatMoney(Math.abs(intercompany), currency)} {icLabel ?? "intercompany"}</span>
        </div>
      )}
    </>
  );
  return to ? (
    <Link to={to} className="lf-card hover:ring-2 hover:ring-brand-200 block">
      {body}
    </Link>
  ) : (
    <div className="lf-card">{body}</div>
  );
}

/** A data-quality warning tile: count of items still needing attention. */
function WarningTile({ label, count, unit, to }: { label: string; count: number; unit: string; to: string }) {
  const ok = count === 0;
  return (
    <Link to={to} className={`lf-card block hover:ring-2 ${ok ? "hover:ring-emerald-200" : "ring-1 ring-amber-200 bg-amber-50 hover:ring-amber-300"}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${ok ? "text-emerald-600" : "text-amber-700"}`}>
        {ok ? "✓ 0" : count}
      </div>
      <div className="mt-1 text-xs text-slate-500">{ok ? "alles gekoppeld" : `${unit} open → koppelen`}</div>
    </Link>
  );
}

/**
 * Always-12-month revenue: stacked current-year bars (net + intercompany up to
 * gross) with a previous-year comparison line overlaid.
 */
function RevenueChart({ data, currency, prevYear }: { data: MonthRevenue[]; currency: string; prevYear: number }) {
  const hasPrev = data.some((d) => Math.abs(d.previous) > 0.005);
  const max = Math.max(1, ...data.map((d) => Math.max(Math.abs(d.currentGross), Math.abs(d.previous))));
  const prevPoints = data
    .map((d, i) => `${((i + 0.5) / 12) * 100},${100 - (Math.max(0, d.previous) / max) * 100}`)
    .join(" ");
  return (
    <div>
      <div className="relative h-40">
        <div className="flex items-end gap-1 h-40">
          {data.map((d) => {
            const netH = (Math.max(0, d.current) / max) * 100;
            const icH = (Math.max(0, d.currentIc) / max) * 100;
            return (
              <div key={d.month} className="flex-1 h-full flex flex-col justify-end group relative">
                <div className="w-full bg-rose-200" style={{ height: `${icH}%` }} title="Intercompany (geëlimineerd)" />
                <div className="w-full bg-brand-500" style={{ height: `${netH}%` }} title="Netto omzet" />
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-slate-800 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap z-10">
                  {MONTHS[d.month - 1]}: netto {formatMoney(d.current, currency)}
                  {d.currentIc > 0.005 && <> · IC {formatMoney(d.currentIc, currency)}</>}
                  {Math.abs(d.previous) > 0.005 && <> · {prevYear}: {formatMoney(d.previous, currency)}</>}
                </div>
              </div>
            );
          })}
        </div>
        {/* Previous-year line (only when prior-year data is available) */}
        {hasPrev && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
            <polyline points={prevPoints} fill="none" stroke="#475569" strokeWidth="0.7" vectorEffect="non-scaling-stroke" strokeDasharray="2 1.5" />
          </svg>
        )}
      </div>
      <div className="flex gap-1 mt-1">
        {MONTHS.map((m) => (
          <div key={m} className="flex-1 text-center text-[10px] text-slate-400">{m}</div>
        ))}
      </div>
    </div>
  );
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
  const { workspace, group, entity, dateFrom, dateTo, currency } = useScope();
  const { user } = useAuth();
  const on = (key: string) => isWidgetEnabled(user?.dashboardWidgets ?? undefined, key);

  const { data: subResp } = useQuery({
    queryKey: ["billing-subscription", workspace?.id],
    queryFn: () => api<{ subscription: Subscription | null }>("/api/billing/subscription"),
    enabled: !!workspace,
  });
  const sub = subResp?.subscription ?? null;

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ["dashboard-kpis", workspace?.id, group?.id, entity?.id, dateFrom, dateTo, currency],
    queryFn: () => api<Kpis>(`/api/dashboard/kpis?from=${dateFrom}&to=${dateTo}&currency=${currency}`),
    enabled: !!workspace,
  });

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

      {/* KPI's — geconsolideerd over de scope, intercompany op transactieniveau geëlimineerd */}
      {workspace && (
        <div className="space-y-4">
          {kpisLoading && <div className="lf-card text-sm text-slate-500">Kerncijfers laden…</div>}

          {kpis && (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h2 className="text-lg font-semibold">Kerncijfers</h2>
                <div className="text-xs text-slate-400">
                  {dateFrom} t/m {dateTo} · {kpis.currency}
                  {kpis.entities.filter((e) => e.included).length > 1 &&
                    ` · geconsolideerd (${kpis.entities.filter((e) => e.included).length} administraties${
                      kpis.intercompanyConfigured ? ", na intercompany-eliminatie" : ""
                    })`}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {on("cash") && <KpiTile label="Cashpositie" value={kpis.cash} currency={kpis.currency} to="/data/general-ledger" />}
                {on("workingCapital") && (
                  <KpiTile label="Werkkapitaal" value={kpis.workingCapital.net} currency={kpis.currency} />
                )}
                {on("receivables") && (
                  <KpiTile
                    label="Openstaande debiteuren"
                    value={kpis.outstandingDebtors.net}
                    currency={kpis.currency}
                    gross={kpis.outstandingDebtors.gross}
                    intercompany={kpis.outstandingDebtors.intercompany}
                    to="/data/receivables"
                  />
                )}
                {on("payables") && (
                  <KpiTile
                    label="Openstaande crediteuren"
                    value={kpis.outstandingCreditors.net}
                    currency={kpis.currency}
                    gross={kpis.outstandingCreditors.gross}
                    intercompany={kpis.outstandingCreditors.intercompany}
                    to="/data/payables"
                  />
                )}
                {on("unmappedRgs") && <WarningTile label="Nog toe te kennen RGS" count={kpis.unmappedRgsAccounts} unit="rekening(en)" to="/mappings/rgs" />}
                {on("unmappedVat") && <WarningTile label="Nog toe te kennen BTW" count={kpis.unmappedVatCodes} unit="btw-code(s)" to="/administration/account-tax" />}
              </div>

              {on("revenue") && (
                <div className="lf-card">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <h3 className="font-semibold">Omzetontwikkeling per maand · {kpis.revenueYear}</h3>
                    <div className="text-xs text-slate-500">
                      Netto {formatMoney(kpis.revenueTotal.net, kpis.currency)}
                      {kpis.revenueTotal.intercompany > 0.005 && (
                        <span className="text-rose-600"> · −{formatMoney(kpis.revenueTotal.intercompany, kpis.currency)} intercompany</span>
                      )}
                      {kpis.revenuePrevTotal !== 0 && (
                        <span className="text-slate-400"> · {kpis.revenuePrevYear}: {formatMoney(kpis.revenuePrevTotal, kpis.currency)}</span>
                      )}
                    </div>
                  </div>
                  <RevenueChart data={kpis.revenueByMonth} currency={kpis.currency} prevYear={kpis.revenuePrevYear} />
                  <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500 flex-wrap">
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 bg-brand-500 rounded-sm" /> Netto omzet {kpis.revenueYear}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="inline-block w-3 h-3 bg-rose-200 rounded-sm" /> Intercompany (geëlimineerd)
                    </span>
                    {kpis.revenuePrevTotal !== 0 && (
                      <span className="flex items-center gap-1">
                        <span className="inline-block w-4 border-t-2 border-dashed border-slate-600" /> {kpis.revenuePrevYear}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {kpis.warnings.length > 0 && (
                <div className="lf-card bg-amber-50 ring-amber-200 text-amber-900 text-xs space-y-1">
                  {kpis.warnings.map((w, i) => (
                    <div key={i}>⚠️ {w}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

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

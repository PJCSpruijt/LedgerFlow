import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, ApiError } from "../services/api";
import { useScope } from "../contexts/ScopeContext";

interface PlanOption {
  key: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: "MONTH" | "YEAR";
  features: string[];
  checkoutAvailable: boolean;
}

interface Subscription {
  plan: string | null;
  planKey: string | null;
  planName: string | null;
  status: string;
  validUntil: string | null;
}

const fmtPrice = (cents: number, currency: string, interval: string) => {
  const amount = (cents / 100).toLocaleString("nl-NL", { style: "currency", currency });
  return `${amount} / ${interval === "YEAR" ? "jaar" : "maand"}`;
};

export function BillingPage() {
  const { workspace } = useScope();
  const location = useLocation();
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await api<{ plans: PlanOption[] }>("/api/billing/plans");
        setPlans(r.plans);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Kon plannen niet laden");
      }
    })();
  }, []);

  useEffect(() => {
    if (!workspace) return;
    void (async () => {
      try {
        const r = await api<{ subscription: Subscription | null }>("/api/billing/subscription");
        setSub(r.subscription);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Kon abonnement niet laden");
      }
    })();
  }, [workspace?.id]);

  const startCheckout = async (planKey: string) => {
    setErr(null);
    setBusyPlan(planKey);
    try {
      const r = await api<{ url: string }>("/api/billing/create-checkout-session", {
        method: "POST",
        body: { plan: planKey },
      });
      if (r.url) window.location.href = r.url;
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Checkout mislukt");
    } finally {
      setBusyPlan(null);
    }
  };

  const showSuccess = location.pathname.endsWith("/success");
  const showCancel = location.pathname.endsWith("/cancel");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Abonnement</h1>
        <p className="text-sm text-slate-500 mt-1">
          Kies een plan om syncs, exports en AI-functies te ontgrendelen.
        </p>
      </div>

      {showSuccess && (
        <div className="lf-card bg-emerald-50 ring-emerald-200 text-emerald-800">
          Bedankt! Je betaling is ontvangen. Je abonnement wordt zo geactiveerd.
        </div>
      )}
      {showCancel && (
        <div className="lf-card bg-amber-50 ring-amber-200 text-amber-900">
          Checkout afgebroken. Je kunt op elk moment opnieuw beginnen.
        </div>
      )}

      <div className="lf-card max-w-xl">
        <div className="text-sm text-slate-500">Huidige status</div>
        <div className="text-lg font-semibold mt-1">
          {sub?.planName ?? "Geen plan"} — {sub?.status ?? "NONE"}
        </div>
        {sub?.validUntil && (
          <div className="text-xs text-slate-500 mt-1">
            Geldig tot {new Date(sub.validUntil).toLocaleDateString("nl-NL")}
          </div>
        )}
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {plans.map((p) => {
          const current = sub?.planKey === p.key;
          return (
            <div
              key={p.key}
              className={`lf-card flex flex-col ${current ? "ring-2 ring-brand-500" : ""}`}
            >
              <div className="text-lg font-semibold">{p.name}</div>
              <div className="text-2xl font-bold mt-2">
                {fmtPrice(p.priceCents, p.currency, p.interval)}
              </div>
              {p.description && (
                <div className="text-sm text-slate-500 mt-1">{p.description}</div>
              )}
              <ul className="text-sm text-slate-600 mt-4 space-y-1 flex-1">
                {p.features.map((f) => (
                  <li key={f}>• {f}</li>
                ))}
              </ul>
              {current ? (
                <div className="lf-pill bg-emerald-100 text-emerald-800 mt-4 self-start">
                  Huidig plan
                </div>
              ) : p.checkoutAvailable ? (
                <button
                  className="lf-btn-primary mt-4"
                  disabled={busyPlan !== null}
                  onClick={() => startCheckout(p.key)}
                >
                  {busyPlan === p.key ? "Bezig…" : "Kies dit plan"}
                </button>
              ) : (
                <div className="text-xs text-slate-400 mt-4">Neem contact op voor dit plan.</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

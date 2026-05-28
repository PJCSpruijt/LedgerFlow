import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, ApiError } from "../services/api";
import { useOrg } from "../contexts/OrganizationContext";

type Plan = "STARTER" | "PROFESSIONAL" | "OFFICE";

const PLANS: { key: Plan; name: string; price: string; features: string[] }[] = [
  {
    key: "STARTER",
    name: "Starter",
    price: "€ 29 / maand",
    features: ["1 Yuki-administratie", "Excel-exports", "E-mail support"],
  },
  {
    key: "PROFESSIONAL",
    name: "Professional",
    price: "€ 79 / maand",
    features: ["5 administraties", "AI-commentaar (beta)", "Prioriteit support"],
  },
  {
    key: "OFFICE",
    name: "Office",
    price: "€ 199 / maand",
    features: ["Onbeperkte administraties", "Excel Add-in", "API toegang"],
  },
];

interface Subscription {
  plan: Plan | null;
  status: string;
  validUntil: string | null;
}

export function BillingPage() {
  const { current } = useOrg();
  const location = useLocation();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyPlan, setBusyPlan] = useState<Plan | null>(null);

  useEffect(() => {
    if (!current) return;
    void (async () => {
      try {
        const r = await api<{ subscription: Subscription | null }>("/api/billing/subscription");
        setSub(r.subscription);
      } catch (e) {
        setErr(e instanceof ApiError ? e.message : "Kon abonnement niet laden");
      }
    })();
  }, [current]);

  const startCheckout = async (plan: Plan) => {
    setErr(null);
    setBusyPlan(plan);
    try {
      const r = await api<{ url: string }>("/api/billing/create-checkout-session", {
        method: "POST",
        body: { plan },
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
          {sub?.plan ?? "Geen plan"} — {sub?.status ?? "NONE"}
        </div>
        {sub?.validUntil && (
          <div className="text-xs text-slate-500 mt-1">
            Geldig tot {new Date(sub.validUntil).toLocaleDateString("nl-NL")}
          </div>
        )}
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {PLANS.map((p) => (
          <div key={p.key} className="lf-card flex flex-col">
            <div className="text-lg font-semibold">{p.name}</div>
            <div className="text-2xl font-bold mt-2">{p.price}</div>
            <ul className="text-sm text-slate-600 mt-4 space-y-1 flex-1">
              {p.features.map((f) => (
                <li key={f}>• {f}</li>
              ))}
            </ul>
            <button
              className="lf-btn-primary mt-4"
              disabled={busyPlan !== null}
              onClick={() => startCheckout(p.key)}
            >
              {busyPlan === p.key ? "Bezig…" : "Kies dit plan"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

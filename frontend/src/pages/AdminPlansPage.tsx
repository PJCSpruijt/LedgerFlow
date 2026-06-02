import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../services/api";

interface ModuleDef {
  key: string;
  label: string;
  description: string;
}

interface Plan {
  id: string;
  key: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  interval: "MONTH" | "YEAR";
  modules: string[];
  maxAdministrations: number | null;
  maxUsers: number | null;
  maxApiKeys: number | null;
  stripePriceId: string | null;
  active: boolean;
  sortOrder: number;
  subscriberCount: number;
}

interface FormState {
  key: string;
  name: string;
  description: string;
  priceEuros: string;
  currency: string;
  interval: "MONTH" | "YEAR";
  modules: Set<string>;
  maxAdministrations: string;
  maxUsers: string;
  maxApiKeys: string;
  stripePriceId: string;
  active: boolean;
  sortOrder: string;
}

const emptyForm = (sortOrder: number): FormState => ({
  key: "",
  name: "",
  description: "",
  priceEuros: "0",
  currency: "EUR",
  interval: "MONTH",
  modules: new Set(),
  maxAdministrations: "",
  maxUsers: "",
  maxApiKeys: "",
  stripePriceId: "",
  active: true,
  sortOrder: String(sortOrder),
});

const numOrEmpty = (n: number | null) => (n == null ? "" : String(n));

function formFromPlan(p: Plan): FormState {
  return {
    key: p.key,
    name: p.name,
    description: p.description ?? "",
    priceEuros: (p.priceCents / 100).toFixed(2),
    currency: p.currency,
    interval: p.interval,
    modules: new Set(p.modules),
    maxAdministrations: numOrEmpty(p.maxAdministrations),
    maxUsers: numOrEmpty(p.maxUsers),
    maxApiKeys: numOrEmpty(p.maxApiKeys),
    stripePriceId: p.stripePriceId ?? "",
    active: p.active,
    sortOrder: String(p.sortOrder),
  };
}

const fmtPrice = (cents: number, currency: string, interval: string) => {
  const amount = (cents / 100).toLocaleString("nl-NL", { style: "currency", currency });
  return `${amount} / ${interval === "YEAR" ? "jaar" : "maand"}`;
};

export function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [modules, setModules] = useState<ModuleDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // null = no editor open; "new" = create; otherwise the plan id being edited.
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState | null>(null);

  const load = async () => {
    try {
      const [p, m] = await Promise.all([
        api<{ plans: Plan[] }>("/api/admin/plans"),
        api<{ modules: ModuleDef[] }>("/api/admin/modules"),
      ]);
      setPlans(p.plans);
      setModules(m.modules);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kon plannen niet laden");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const nextSortOrder = useMemo(
    () => (plans.length ? Math.max(...plans.map((p) => p.sortOrder)) + 1 : 1),
    [plans],
  );

  const startCreate = () => {
    setErr(null);
    setEditingId("new");
    setForm(emptyForm(nextSortOrder));
  };

  const startEdit = (p: Plan) => {
    setErr(null);
    setEditingId(p.id);
    setForm(formFromPlan(p));
  };

  const cancel = () => {
    setEditingId(null);
    setForm(null);
  };

  const toggleModule = (key: string) => {
    setForm((f) => {
      if (!f) return f;
      const next = new Set(f.modules);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...f, modules: next };
    });
  };

  const save = async () => {
    if (!form) return;
    setErr(null);
    setBusy(true);
    try {
      const priceCents = Math.round(Number(form.priceEuros.replace(",", ".")) * 100);
      if (!Number.isFinite(priceCents) || priceCents < 0) {
        throw new ApiError(400, "BAD_PRICE", "Ongeldige prijs");
      }
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        priceCents,
        currency: form.currency.trim().toUpperCase(),
        interval: form.interval,
        modules: [...form.modules],
        maxAdministrations: form.maxAdministrations.trim() === "" ? null : Number(form.maxAdministrations),
        maxUsers: form.maxUsers.trim() === "" ? null : Number(form.maxUsers),
        maxApiKeys: form.maxApiKeys.trim() === "" ? null : Number(form.maxApiKeys),
        stripePriceId: form.stripePriceId.trim() || null,
        active: form.active,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (editingId === "new") {
        await api("/api/admin/plans", {
          method: "POST",
          body: { ...payload, key: form.key.trim().toUpperCase() },
        });
      } else if (editingId) {
        await api(`/api/admin/plans/${editingId}`, { method: "PATCH", body: payload });
      }
      cancel();
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Plan) => {
    if (!window.confirm(`Plan "${p.name}" verwijderen?`)) return;
    setErr(null);
    setBusy(true);
    try {
      await api(`/api/admin/plans/${p.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Verwijderen mislukt");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="lf-card">Plannen laden…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Abonnementen</h1>
          <p className="text-sm text-slate-500 mt-1">
            Beheer de plannen: naam, prijs en welke modules ze ontgrendelen.
          </p>
        </div>
        <button className="lf-btn-primary" onClick={startCreate} disabled={editingId !== null}>
          + Nieuw plan
        </button>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      {editingId !== null && form && (
        <div className="lf-card space-y-4 ring-brand-200">
          <h2 className="text-lg font-semibold">
            {editingId === "new" ? "Nieuw plan" : `Plan bewerken — ${form.name || form.key}`}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="lf-label">Key (machine-id)</label>
              <input
                className="lf-input font-mono"
                value={form.key}
                disabled={editingId !== "new"}
                placeholder="BV. STARTER"
                onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase() })}
              />
              <p className="text-xs text-slate-400 mt-1">
                Alleen hoofdletters, cijfers en _. Niet wijzigbaar na aanmaken.
              </p>
            </div>
            <div>
              <label className="lf-label">Naam</label>
              <input
                className="lf-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="lf-label">Omschrijving</label>
            <input
              className="lf-input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <label className="lf-label">Prijs</label>
              <input
                className="lf-input"
                type="number"
                min="0"
                step="0.01"
                value={form.priceEuros}
                onChange={(e) => setForm({ ...form, priceEuros: e.target.value })}
              />
            </div>
            <div>
              <label className="lf-label">Valuta</label>
              <input
                className="lf-input"
                maxLength={3}
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
              />
            </div>
            <div>
              <label className="lf-label">Interval</label>
              <select
                className="lf-input"
                value={form.interval}
                onChange={(e) =>
                  setForm({ ...form, interval: e.target.value as "MONTH" | "YEAR" })
                }
              >
                <option value="MONTH">per maand</option>
                <option value="YEAR">per jaar</option>
              </select>
            </div>
            <div>
              <label className="lf-label">Sorteervolgorde</label>
              <input
                className="lf-input"
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="lf-label">Limieten (leeg = ongelimiteerd)</label>
            <div className="mt-1 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <span className="text-xs text-slate-500">Max. administraties</span>
                <input className="lf-input" type="number" min={0} placeholder="∞" value={form.maxAdministrations} onChange={(e) => setForm({ ...form, maxAdministrations: e.target.value })} />
              </div>
              <div>
                <span className="text-xs text-slate-500">Max. gebruikers</span>
                <input className="lf-input" type="number" min={0} placeholder="∞" value={form.maxUsers} onChange={(e) => setForm({ ...form, maxUsers: e.target.value })} />
              </div>
              <div>
                <span className="text-xs text-slate-500">Max. API-sleutels</span>
                <input className="lf-input" type="number" min={0} placeholder="∞" value={form.maxApiKeys} onChange={(e) => setForm({ ...form, maxApiKeys: e.target.value })} />
              </div>
            </div>
          </div>

          <div>
            <label className="lf-label">Modules / opties</label>
            <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
              {modules.map((m) => (
                <label
                  key={m.key}
                  className="flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm cursor-pointer hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={form.modules.has(m.key)}
                    onChange={() => toggleModule(m.key)}
                  />
                  <span>
                    <span className="font-medium">{m.label}</span>
                    <span className="block text-xs text-slate-500">{m.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
            <div>
              <label className="lf-label">Stripe price-id (optioneel)</label>
              <input
                className="lf-input font-mono"
                value={form.stripePriceId}
                placeholder="price_…"
                onChange={(e) => setForm({ ...form, stripePriceId: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm py-2">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Actief (zichtbaar op de Abonnement-pagina)
            </label>
          </div>

          <div className="flex gap-3">
            <button className="lf-btn-primary" onClick={save} disabled={busy}>
              {busy ? "Opslaan…" : "Opslaan"}
            </button>
            <button className="lf-btn-secondary" onClick={cancel} disabled={busy}>
              Annuleren
            </button>
          </div>
        </div>
      )}

      <div className="lf-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4 font-medium">Plan</th>
                <th className="py-2 pr-4 font-medium">Prijs</th>
                <th className="py-2 pr-4 font-medium">Modules</th>
                <th className="py-2 pr-4 font-medium">Abonnees</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-4">
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs font-mono text-slate-400">{p.key}</div>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {fmtPrice(p.priceCents, p.currency, p.interval)}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex flex-wrap gap-1 max-w-md">
                      {p.modules.length === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        p.modules.map((m) => (
                          <span key={m} className="lf-pill bg-slate-100 text-slate-700">
                            {modules.find((x) => x.key === m)?.label ?? m}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-4 text-slate-600">{p.subscriberCount}</td>
                  <td className="py-2 pr-4">
                    {p.active ? (
                      <span className="lf-pill bg-emerald-100 text-emerald-800">Actief</span>
                    ) : (
                      <span className="lf-pill bg-slate-200 text-slate-600">Inactief</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap text-right">
                    <button
                      className="lf-link text-xs mr-3"
                      onClick={() => startEdit(p)}
                      disabled={editingId !== null}
                    >
                      Bewerken
                    </button>
                    <button
                      className="text-xs text-red-600 hover:underline disabled:opacity-40"
                      onClick={() => remove(p)}
                      disabled={editingId !== null || p.subscriberCount > 0}
                      title={
                        p.subscriberCount > 0
                          ? "Plan met actieve abonnees kan niet worden verwijderd"
                          : undefined
                      }
                    >
                      Verwijderen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

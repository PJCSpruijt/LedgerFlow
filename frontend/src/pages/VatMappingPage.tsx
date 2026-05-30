import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../services/api";
import { isAdminRole, useScope } from "../contexts/ScopeContext";

interface VatMapping {
  id: string;
  entityId: string | null;
  sourceVatCode: string;
  sourceLedgerAccountCode: string;
  targetLedgerCode: string;
}
interface RequiredVat {
  vatCode: string;
  count: number;
  amount: number;
}

function defaultRange(): { from: string; to: string } {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: new Date().toISOString().slice(0, 10) };
}

export function VatMappingPage() {
  const { workspace, entity } = useScope();
  const canEdit = isAdminRole(entity?.role ?? workspace?.role);

  const entities = useMemo(
    () => workspace?.groups.flatMap((g) => g.entities) ?? [],
    [workspace],
  );
  const entityName = (id: string | null) =>
    id ? (entities.find((e) => e.id === id)?.name ?? id) : "Hele werkruimte";

  const [mappings, setMappings] = useState<VatMapping[]>([]);
  const [range, setRange] = useState(defaultRange());
  const [required, setRequired] = useState<RequiredVat[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    sourceVatCode: "",
    targetLedgerCode: "",
    scopeEntity: true, // true = current entity, false = workspace-wide
  });

  const loadMappings = async () => {
    try {
      const r = await api<{ mappings: VatMapping[] }>("/api/vat-mappings");
      setMappings(r.mappings);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kon mappings niet laden");
    }
  };

  useEffect(() => {
    if (workspace) void loadMappings();
  }, [workspace?.id]);

  const scan = async () => {
    setErr(null);
    setScanning(true);
    setRequired(null);
    try {
      const r = await api<{ required: RequiredVat[] }>(
        `/api/vat-mappings/required?from=${range.from}&to=${range.to}`,
      );
      setRequired(r.required);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Scan mislukt");
    } finally {
      setScanning(false);
    }
  };

  const save = async () => {
    if (!form.sourceVatCode.trim() || !form.targetLedgerCode.trim()) return;
    setErr(null);
    setBusy(true);
    try {
      await api("/api/vat-mappings", {
        method: "POST",
        body: {
          sourceVatCode: form.sourceVatCode.trim(),
          targetLedgerCode: form.targetLedgerCode.trim(),
          entityId: form.scopeEntity ? (entity?.id ?? null) : null,
        },
      });
      setForm({ ...form, sourceVatCode: "", targetLedgerCode: "" });
      await loadMappings();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: VatMapping) => {
    if (!window.confirm(`Mapping voor ${m.sourceVatCode} verwijderen?`)) return;
    setBusy(true);
    try {
      await api(`/api/vat-mappings/${m.id}`, { method: "DELETE" });
      await loadMappings();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Verwijderen mislukt");
    } finally {
      setBusy(false);
    }
  };

  if (!workspace) {
    return <div className="lf-card max-w-2xl">Selecteer een werkruimte in de zijbalk.</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">BTW-koppelingen</h1>
        <p className="text-sm text-slate-500 mt-1">
          Bepaal naar welke grootboekrekening btw-codes worden geboekt. De connector leidt dit
          automatisch af waar mogelijk; hier los je de gevallen op die een keuze vereisen.
        </p>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      {/* Data Quality: required mappings */}
      <div className="lf-card space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold">BTW-mapping vereist (datakwaliteit)</h2>
          {!entity && <span className="text-xs text-amber-700">Selecteer een administratie om te scannen.</span>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="lf-label">Van</label>
            <input
              type="date"
              className="lf-input"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </div>
          <div>
            <label className="lf-label">Tot</label>
            <input
              type="date"
              className="lf-input"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </div>
          <button className="lf-btn-secondary" onClick={scan} disabled={!entity || scanning}>
            {scanning ? "Scannen…" : "Controleer"}
          </button>
        </div>

        {required && required.length === 0 && (
          <div className="text-sm text-emerald-700">
            Alle btw-codes in deze periode zijn opgelost — geen mapping vereist.
          </div>
        )}
        {required && required.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2 pr-4 font-medium">BTW-code</th>
                <th className="py-2 pr-4 font-medium">Regels</th>
                <th className="py-2 pr-4 font-medium">Bedrag</th>
                <th className="py-2 pr-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {required.map((r) => (
                <tr key={r.vatCode} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-mono">{r.vatCode}</td>
                  <td className="py-2 pr-4 text-slate-600">{r.count}</td>
                  <td className="py-2 pr-4 text-slate-600">
                    {r.amount.toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {canEdit && (
                      <button
                        className="lf-link text-xs"
                        onClick={() => setForm({ ...form, sourceVatCode: r.vatCode, scopeEntity: true })}
                      >
                        Mapping toevoegen
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Mappings CRUD */}
      <div className="lf-card space-y-4">
        <h2 className="text-lg font-semibold">Eigen btw-koppelingen</h2>

        {canEdit && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="lf-label">BTW-code</label>
              <input
                className="lf-input font-mono"
                placeholder="HOOG_VERK_21"
                value={form.sourceVatCode}
                onChange={(e) => setForm({ ...form, sourceVatCode: e.target.value })}
              />
            </div>
            <div>
              <label className="lf-label">Grootboekrekening (doel)</label>
              <input
                className="lf-input font-mono"
                placeholder="1630"
                value={form.targetLedgerCode}
                onChange={(e) => setForm({ ...form, targetLedgerCode: e.target.value })}
              />
            </div>
            <div>
              <label className="lf-label">Bereik</label>
              <select
                className="lf-input"
                value={form.scopeEntity ? "entity" : "workspace"}
                onChange={(e) => setForm({ ...form, scopeEntity: e.target.value === "entity" })}
              >
                <option value="entity" disabled={!entity}>
                  Deze administratie{entity ? `: ${entity.name}` : " (geen geselecteerd)"}
                </option>
                <option value="workspace">Hele werkruimte</option>
              </select>
            </div>
            <button className="lf-btn-primary" onClick={save} disabled={busy}>
              Opslaan
            </button>
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="py-2 pr-4 font-medium">BTW-code</th>
              <th className="py-2 pr-4 font-medium">Doelrekening</th>
              <th className="py-2 pr-4 font-medium">Bereik</th>
              <th className="py-2 pr-4 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {mappings.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-3 text-slate-400">
                  Nog geen eigen koppelingen — de connector gebruikt automatische afleiding.
                </td>
              </tr>
            ) : (
              mappings.map((m) => (
                <tr key={m.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4 font-mono">{m.sourceVatCode}</td>
                  <td className="py-2 pr-4 font-mono">{m.targetLedgerCode}</td>
                  <td className="py-2 pr-4 text-slate-600">{entityName(m.entityId)}</td>
                  <td className="py-2 pr-4 text-right">
                    {canEdit && (
                      <button
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => remove(m)}
                        disabled={busy}
                      >
                        Verwijderen
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../services/api";
import { useScope } from "../contexts/ScopeContext";

type Kind = "yuki" | "eboekhouden";

interface TestResult {
  ok: boolean;
  message: string;
  administrations?: { id: string; name: string }[];
}

const STEPS = ["Pakket", "Gegevens", "Controle", "Klaar"];

/**
 * Guided, step-by-step setup of a connector for the active administration.
 * Reuses the existing PUT /api/ledger/connection + GET /api/ledger/test-connection.
 */
export function ConnectorWizard({ onClose }: { onClose: () => void }) {
  const { entity, reload } = useScope();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<Kind>("yuki");
  const [form, setForm] = useState({
    accessKey: "",
    administrationId: "",
    environment: "PRODUCTION" as "PRODUCTION" | "SANDBOX",
    accessToken: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [adminName, setAdminName] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  const save = async () => {
    setErr(null);
    setBusy(true);
    try {
      const body =
        kind === "yuki"
          ? { kind, accessKey: form.accessKey, administrationId: form.administrationId, environment: form.environment }
          : { kind, accessToken: form.accessToken };
      const r = await api<{ administrationName: string | null }>("/api/ledger/connection", { method: "PUT", body });
      setAdminName(r.administrationName);
      await reload();
      setStep(2);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setErr(null);
    setBusy(true);
    try {
      setTest(await api<TestResult>("/api/ledger/test-connection"));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Test mislukt");
    } finally {
      setBusy(false);
    }
  };

  const canSave = kind === "yuki" ? !!(form.accessKey && form.administrationId) : !!form.accessToken;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        {/* Stepper */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200 text-xs">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span
                className={`h-5 w-5 rounded-full flex items-center justify-center font-semibold ${
                  i < step ? "bg-emerald-500 text-white" : i === step ? "bg-brand-600 text-white" : "bg-slate-200 text-slate-500"
                }`}
              >
                {i < step ? "✓" : i + 1}
              </span>
              <span className={i === step ? "font-medium" : "text-slate-400"}>{s}</span>
              {i < STEPS.length - 1 && <span className="text-slate-300">›</span>}
            </div>
          ))}
        </div>

        <div className="p-5 space-y-4 min-h-[220px]">
          {!entity && <div className="text-sm text-amber-700">Selecteer eerst een administratie in de bovenbalk.</div>}

          {entity && step === 0 && (
            <>
              <p className="text-sm text-slate-600">
                Koppel <span className="font-medium">{entity.name}</span> aan je boekhoudpakket. Met welk pakket
                werk je?
              </p>
              <div className="grid grid-cols-2 gap-3">
                {(["yuki", "eboekhouden"] as Kind[]).map((k) => (
                  <button
                    key={k}
                    className={`lf-card text-left hover:ring-brand-400 ${kind === k ? "ring-2 ring-brand-500" : ""}`}
                    onClick={() => setKind(k)}
                  >
                    <div className="text-lg font-semibold">{k === "yuki" ? "Yuki" : "e-Boekhouden"}</div>
                    <div className="text-xs text-slate-500 mt-1">
                      {k === "yuki" ? "Web service API-key + administration-ID" : "API-token uit e-Boekhouden"}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {entity && step === 1 && (
            <>
              <p className="text-sm text-slate-600">Vul de gegevens van je {kind === "yuki" ? "Yuki" : "e-Boekhouden"}-koppeling in.</p>
              {kind === "yuki" ? (
                <>
                  <div>
                    <label className="lf-label">Web service API-key</label>
                    <input
                      className="lf-input font-mono text-xs"
                      type="password"
                      value={form.accessKey}
                      onChange={(e) => setForm({ ...form, accessKey: e.target.value })}
                    />
                    <p className="text-xs text-slate-500 mt-1">Yuki → Instellingen → Web services → Web service API-key.</p>
                  </div>
                  <div>
                    <label className="lf-label">Administration ID</label>
                    <input
                      className="lf-input font-mono text-xs"
                      value={form.administrationId}
                      onChange={(e) => setForm({ ...form, administrationId: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="lf-label">Omgeving</label>
                    <select
                      className="lf-input"
                      value={form.environment}
                      onChange={(e) => setForm({ ...form, environment: e.target.value as "PRODUCTION" | "SANDBOX" })}
                    >
                      <option value="PRODUCTION">Productie</option>
                      <option value="SANDBOX">Sandbox</option>
                    </select>
                  </div>
                </>
              ) : (
                <div>
                  <label className="lf-label">e-Boekhouden API-token</label>
                  <input
                    className="lf-input font-mono text-xs"
                    type="password"
                    value={form.accessToken}
                    onChange={(e) => setForm({ ...form, accessToken: e.target.value })}
                  />
                  <p className="text-xs text-slate-500 mt-1">e-Boekhouden → Beheer → Instellingen → API/koppelingen.</p>
                </div>
              )}
              <p className="text-xs text-slate-400">Credentials worden versleuteld opgeslagen (AES-256-GCM).</p>
            </>
          )}

          {entity && step === 2 && (
            <>
              <div className="lf-card bg-emerald-50 ring-emerald-200 text-emerald-900 text-sm">
                Koppeling opgeslagen{adminName ? ` — administratie: ${adminName}` : ""}.
              </div>
              <p className="text-sm text-slate-600">Test de verbinding om zeker te weten dat alles werkt.</p>
              <button className="lf-btn-secondary" onClick={runTest} disabled={busy}>
                {busy ? "Testen…" : "Verbinding testen"}
              </button>
              {test && (
                <div className={`text-sm ${test.ok ? "text-emerald-700" : "text-red-600"}`}>
                  {test.message}
                  {test.administrations && test.administrations.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-slate-700">
                      {test.administrations.map((a) => (
                        <li key={a.id}>{a.name}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}

          {entity && step === 3 && (
            <div className="space-y-3 text-sm">
              <div className="text-lg font-semibold">Gelukt! 🎉</div>
              <p className="text-slate-600">
                {entity.name} is gekoppeld. Volgende stappen:
              </p>
              <div className="flex flex-col gap-2">
                <button className="lf-link text-left" onClick={() => { onClose(); navigate("/mappings/rgs"); }}>
                  → Rekeningen koppelen aan RGS
                </button>
                <button className="lf-link text-left" onClick={() => { onClose(); navigate("/data/transactions"); }}>
                  → Bekijk de transacties
                </button>
                <button className="lf-link text-left" onClick={() => { onClose(); navigate("/data/general-ledger"); }}>
                  → Bekijk het grootboek
                </button>
              </div>
            </div>
          )}

          {err && <div className="text-sm text-red-600">{err}</div>}
        </div>

        {/* Footer nav */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200">
          <button className="lf-link text-sm" onClick={onClose}>
            {step === 3 ? "Sluiten" : "Annuleren"}
          </button>
          <div className="flex gap-2">
            {step > 0 && step < 3 && (
              <button className="lf-btn-secondary text-sm" onClick={() => setStep((s) => s - 1)} disabled={busy}>
                Vorige
              </button>
            )}
            {step === 0 && (
              <button className="lf-btn-primary text-sm" disabled={!entity} onClick={() => setStep(1)}>
                Volgende
              </button>
            )}
            {step === 1 && (
              <button className="lf-btn-primary text-sm" disabled={!canSave || busy} onClick={save}>
                {busy ? "Opslaan…" : "Opslaan"}
              </button>
            )}
            {step === 2 && (
              <button className="lf-btn-primary text-sm" onClick={() => setStep(3)}>
                Voltooien
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

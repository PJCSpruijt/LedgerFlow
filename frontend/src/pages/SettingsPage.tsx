import { useEffect, useState } from "react";
import { isAdminRole, useScope } from "../contexts/ScopeContext";
import { useAuth } from "../contexts/AuthContext";
import { api, ApiError } from "../services/api";

export function SettingsPage() {
  const { workspace, role, reload } = useScope();
  const [name, setName] = useState(workspace?.name ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(workspace?.name ?? "");
  }, [workspace?.id, workspace?.name]);

  if (!workspace) return <div>Selecteer een werkruimte.</div>;

  const canEdit = isAdminRole(workspace.role);

  const save = async () => {
    setMsg(null);
    setErr(null);
    setSaving(true);
    try {
      await api("/api/workspaces/current", { method: "PATCH", body: { name } });
      await reload();
      setMsg("Opgeslagen");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Instellingen</h1>
        <p className="text-sm text-slate-500 mt-1">Werkruimteprofiel, rol en beveiliging.</p>
      </div>
      <div className="lf-card max-w-xl space-y-4">
        <div>
          <label className="lf-label">Naam werkruimte</label>
          <input
            className="lf-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canEdit}
          />
        </div>
        <div>
          <label className="lf-label">Jouw rol</label>
          <div className="text-sm text-slate-700">{role}</div>
        </div>
        {msg && <div className="text-sm text-emerald-700">{msg}</div>}
        {err && <div className="text-sm text-red-600">{err}</div>}
        <button onClick={save} disabled={!canEdit || saving} className="lf-btn-primary">
          {saving ? "Bezig…" : "Opslaan"}
        </button>
      </div>

      <TwoFactorSection />
    </div>
  );
}

function TwoFactorSection() {
  const { user, refreshUser } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Enrollment in progress: holds the QR + secret returned by /2fa/setup.
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");

  const enabled = !!user?.twoFactorEnabled;
  const required = !!user?.twoFactorRequired;

  const startSetup = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = await api<{ qrDataUrl: string; secret: string }>("/auth/2fa/setup", {
        method: "POST",
      });
      setSetup({ qrDataUrl: r.qrDataUrl, secret: r.secret });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kon 2FA niet starten");
    } finally {
      setBusy(false);
    }
  };

  const enable = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api("/auth/2fa/enable", { method: "POST", body: { code } });
      setSetup(null);
      setCode("");
      await refreshUser();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Activeren mislukt");
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setErr(null);
    setBusy(true);
    try {
      await api("/auth/2fa/disable", { method: "POST", body: { code } });
      setCode("");
      await refreshUser();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Uitschakelen mislukt");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lf-card max-w-xl space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Tweestapsverificatie (2FA)</h2>
        <p className="text-sm text-slate-500 mt-1">
          Beveilig je account met een authenticator-app (TOTP).
        </p>
      </div>

      <div className="text-sm">
        Status:{" "}
        {enabled ? (
          <span className="lf-pill bg-emerald-100 text-emerald-800">Ingeschakeld</span>
        ) : (
          <span className="lf-pill bg-slate-200 text-slate-600">Uitgeschakeld</span>
        )}
        {required && !enabled && (
          <span className="ml-2 text-amber-700">Je beheerder vereist 2FA — stel het in.</span>
        )}
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      {!enabled && !setup && (
        <button className="lf-btn-primary" onClick={startSetup} disabled={busy}>
          {busy ? "Bezig…" : "2FA instellen"}
        </button>
      )}

      {!enabled && setup && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Scan deze QR-code met je authenticator-app en voer de 6-cijferige code in.
          </p>
          <img src={setup.qrDataUrl} alt="2FA QR-code" className="w-44 h-44" />
          <p className="text-xs text-slate-500 break-all">
            Of voer deze sleutel handmatig in: <span className="font-mono">{setup.secret}</span>
          </p>
          <div className="flex items-end gap-3">
            <div>
              <label className="lf-label">Verificatiecode</label>
              <input
                className="lf-input tracking-widest text-center"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <button className="lf-btn-primary" onClick={enable} disabled={busy || code.length < 6}>
              Inschakelen
            </button>
            <button
              className="lf-btn-secondary"
              onClick={() => {
                setSetup(null);
                setCode("");
              }}
              disabled={busy}
            >
              Annuleren
            </button>
          </div>
        </div>
      )}

      {enabled && (
        <div className="space-y-2">
          {required ? (
            <p className="text-sm text-slate-500">
              Je beheerder heeft 2FA verplicht; uitschakelen is niet mogelijk.
            </p>
          ) : (
            <div className="flex items-end gap-3">
              <div>
                <label className="lf-label">Code om uit te schakelen</label>
                <input
                  className="lf-input tracking-widest text-center"
                  inputMode="numeric"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <button
                className="lf-btn-danger"
                onClick={disable}
                disabled={busy || code.length < 6}
              >
                2FA uitschakelen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

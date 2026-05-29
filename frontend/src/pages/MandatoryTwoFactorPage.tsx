import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../services/api";
import { useAuth } from "../contexts/AuthContext";

/**
 * Full-screen blocking enrollment shown when an admin has mandated 2FA but the
 * user hasn't enrolled yet. The user cannot reach the app until 2FA is enabled;
 * the only escape is logging out. On success refreshUser() flips the gate open.
 */
export function MandatoryTwoFactorPage() {
  const { refreshUser, logout } = useAuth();
  const nav = useNavigate();
  const [setup, setSetup] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      await refreshUser();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Activeren mislukt");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="lf-card max-w-md w-full space-y-4">
        <div>
          <h1 className="text-xl font-semibold">Tweestapsverificatie vereist</h1>
          <p className="text-sm text-slate-500 mt-1">
            Je beheerder heeft 2FA verplicht. Stel het in om verder te gaan.
          </p>
        </div>

        {err && <div className="text-sm text-red-600">{err}</div>}

        {!setup ? (
          <button className="lf-btn-primary w-full" onClick={startSetup} disabled={busy}>
            {busy ? "Bezig…" : "2FA instellen"}
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Scan deze QR-code met je authenticator-app en voer de 6-cijferige code in.
            </p>
            <img src={setup.qrDataUrl} alt="2FA QR-code" className="w-44 h-44 mx-auto" />
            <p className="text-xs text-slate-500 break-all">
              Of voer deze sleutel handmatig in: <span className="font-mono">{setup.secret}</span>
            </p>
            <div>
              <label className="lf-label">Verificatiecode</label>
              <input
                className="lf-input tracking-widest text-center"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <button
              className="lf-btn-primary w-full"
              onClick={enable}
              disabled={busy || code.length < 6}
            >
              {busy ? "Bezig…" : "Inschakelen"}
            </button>
          </div>
        )}

        <button
          className="lf-link text-sm w-full text-center"
          onClick={async () => {
            await logout();
            nav("/login");
          }}
        >
          Uitloggen
        </button>
      </div>
    </div>
  );
}

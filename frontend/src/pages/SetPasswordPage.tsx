import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../services/api";

/**
 * Shared password-setup page for two public flows:
 *  - invite: accept an admin invitation (POST /auth/accept-invitation)
 *  - reset:  complete a password reset (POST /auth/reset-password)
 * The single-use token comes from the email link's ?token= query param.
 */
function SetPasswordPage({ mode }: { mode: "invite" | "reset" }) {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const path = mode === "invite" ? "/auth/accept-invitation" : "/auth/reset-password";
  const title = mode === "invite" ? "Stel je wachtwoord in" : "Nieuw wachtwoord";

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Wachtwoorden komen niet overeen");
      return;
    }
    setSubmitting(true);
    try {
      await api(path, { method: "POST", body: { token, password }, skipAuth: true });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mislukt");
    } finally {
      setSubmitting(false);
    }
  };

  if (!token) {
    return <div className="text-sm text-red-600">Ongeldige of ontbrekende link.</div>;
  }

  if (done) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Gelukt</h2>
        <p className="text-sm text-slate-600">Je wachtwoord is ingesteld. Je kunt nu inloggen.</p>
        <Link to="/login" className="lf-btn-primary inline-block">
          Naar inloggen
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div>
        <label className="lf-label">Wachtwoord</label>
        <input
          className="lf-input"
          type="password"
          required
          minLength={10}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-slate-400 mt-1">Minstens 10 tekens.</p>
      </div>
      <div>
        <label className="lf-label">Herhaal wachtwoord</label>
        <input
          className="lf-input"
          type="password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <button type="submit" className="lf-btn-primary w-full" disabled={submitting}>
        {submitting ? "Bezig…" : "Opslaan"}
      </button>
    </form>
  );
}

export function AcceptInvitationPage() {
  return <SetPasswordPage mode="invite" />;
}

export function ResetPasswordPage() {
  return <SetPasswordPage mode="reset" />;
}

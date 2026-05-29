import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { ApiError } from "../services/api";

export function LoginPage() {
  const { login, verifyTwoFactor } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // When set, the password step succeeded and a TOTP code is required.
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState("");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const r = await login(email, password);
      if (r.twoFactorRequired) {
        setChallengeToken(r.challengeToken);
      } else {
        nav("/dashboard");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Inloggen mislukt");
    } finally {
      setSubmitting(false);
    }
  };

  const onVerify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await verifyTwoFactor(challengeToken!, code);
      nav("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verificatie mislukt");
    } finally {
      setSubmitting(false);
    }
  };

  if (challengeToken) {
    return (
      <form onSubmit={onVerify} className="space-y-4">
        <h2 className="text-xl font-semibold">Tweestapsverificatie</h2>
        <p className="text-sm text-slate-500">
          Voer de 6-cijferige code uit je authenticator-app in.
        </p>
        <div>
          <label className="lf-label">Verificatiecode</label>
          <input
            className="lf-input tracking-widest text-center"
            inputMode="numeric"
            autoFocus
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button type="submit" className="lf-btn-primary w-full" disabled={submitting}>
          {submitting ? "Bezig…" : "Verifiëren"}
        </button>
        <button
          type="button"
          className="lf-link text-sm w-full text-center"
          onClick={() => {
            setChallengeToken(null);
            setCode("");
            setError(null);
          }}
        >
          Terug
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold">Inloggen</h2>
      <div>
        <label className="lf-label">E-mailadres</label>
        <input
          className="lf-input"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        <label className="lf-label">Wachtwoord</label>
        <input
          className="lf-input"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <button type="submit" className="lf-btn-primary w-full" disabled={submitting}>
        {submitting ? "Bezig…" : "Inloggen"}
      </button>
      <div className="text-sm text-slate-500 text-center">
        Nog geen account?{" "}
        <Link to="/register" className="lf-link">
          Registreer hier
        </Link>
      </div>
    </form>
  );
}

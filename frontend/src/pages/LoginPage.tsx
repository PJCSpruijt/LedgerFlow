import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { ApiError } from "../services/api";

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      nav("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Inloggen mislukt");
    } finally {
      setSubmitting(false);
    }
  };

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

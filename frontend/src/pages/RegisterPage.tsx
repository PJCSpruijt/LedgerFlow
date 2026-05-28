import { useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { ApiError } from "../services/api";

export function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({
    email: "",
    password: "",
    firstName: "",
    lastName: "",
    organizationName: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof typeof form>(k: K) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(form);
      nav("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registreren mislukt");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-xl font-semibold">Account aanmaken</h2>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="lf-label">Voornaam</label>
          <input className="lf-input" required value={form.firstName} onChange={set("firstName")} />
        </div>
        <div>
          <label className="lf-label">Achternaam</label>
          <input className="lf-input" required value={form.lastName} onChange={set("lastName")} />
        </div>
      </div>
      <div>
        <label className="lf-label">E-mailadres</label>
        <input className="lf-input" type="email" required value={form.email} onChange={set("email")} />
      </div>
      <div>
        <label className="lf-label">Wachtwoord (min. 10 tekens)</label>
        <input
          className="lf-input"
          type="password"
          minLength={10}
          required
          value={form.password}
          onChange={set("password")}
        />
      </div>
      <div>
        <label className="lf-label">Bedrijfsnaam</label>
        <input
          className="lf-input"
          required
          value={form.organizationName}
          onChange={set("organizationName")}
        />
      </div>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <button type="submit" className="lf-btn-primary w-full" disabled={submitting}>
        {submitting ? "Bezig…" : "Account aanmaken"}
      </button>
      <div className="text-sm text-slate-500 text-center">
        Al een account?{" "}
        <Link to="/login" className="lf-link">
          Inloggen
        </Link>
      </div>
    </form>
  );
}

import { useEffect, useState } from "react";
import { api, ApiError } from "../services/api";
import { useAuth } from "../contexts/AuthContext";

interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  platformRole: "PLATFORM_ADMIN" | "USER";
  twoFactorEnabled: boolean;
  twoFactorRequired: boolean;
  createdAt: string;
  membershipCount: number;
}

interface FormState {
  email: string;
  firstName: string;
  lastName: string;
  platformRole: "PLATFORM_ADMIN" | "USER";
}

const emptyForm: FormState = { email: "", firstName: "", lastName: "", platformRole: "USER" };
const fmtDate = (s: string) => new Date(s).toLocaleDateString("nl-NL");

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const load = async () => {
    try {
      const r = await api<{ users: AdminUser[] }>("/api/admin/users");
      setUsers(r.users);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Kon gebruikers niet laden");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startCreate = () => {
    setErr(null);
    setNotice(null);
    setForm(emptyForm);
    setEditingId("new");
  };
  const startEdit = (u: AdminUser) => {
    setErr(null);
    setNotice(null);
    setForm({
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      platformRole: u.platformRole,
    });
    setEditingId(u.id);
  };
  const cancel = () => {
    setEditingId(null);
  };

  const save = async () => {
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      if (editingId === "new") {
        const r = await api<{ emailDelivered: boolean; inviteUrl?: string }>("/api/admin/users", {
          method: "POST",
          body: form,
        });
        setNotice(
          r.emailDelivered
            ? "Gebruiker aangemaakt — uitnodiging verstuurd."
            : `Gebruiker aangemaakt. E-mail niet geconfigureerd; deel deze uitnodigingslink:\n${r.inviteUrl}`,
        );
      } else if (editingId) {
        await api(`/api/admin/users/${editingId}`, { method: "PATCH", body: form });
        setNotice("Gebruiker bijgewerkt.");
      }
      cancel();
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Opslaan mislukt");
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (u: AdminUser) => {
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      const r = await api<{ emailDelivered: boolean; resetUrl?: string }>(
        `/api/admin/users/${u.id}/reset-password`,
        { method: "POST" },
      );
      setNotice(
        r.emailDelivered
          ? `Reset-link verstuurd naar ${u.email}.`
          : `E-mail niet geconfigureerd; deel deze reset-link met ${u.email}:\n${r.resetUrl}`,
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Reset mislukt");
    } finally {
      setBusy(false);
    }
  };

  const twoFactorAction = async (u: AdminUser, action: "require" | "unrequire" | "disable") => {
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      await api(`/api/admin/users/${u.id}/2fa`, { method: "POST", body: { action } });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "2FA-actie mislukt");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: AdminUser) => {
    if (!window.confirm(`Gebruiker ${u.email} verwijderen?`)) return;
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      await api(`/api/admin/users/${u.id}`, { method: "DELETE" });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Verwijderen mislukt");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="lf-card">Gebruikers laden…</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Gebruikers</h1>
          <p className="text-sm text-slate-500 mt-1">
            Beheer gebruikers: aanmaken, bewerken, wachtwoord-reset en 2FA.
          </p>
        </div>
        <button className="lf-btn-primary" onClick={startCreate} disabled={editingId !== null}>
          + Nieuwe gebruiker
        </button>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}
      {notice && (
        <div className="lf-card bg-emerald-50 ring-emerald-200 text-emerald-900 text-sm whitespace-pre-wrap break-all">
          {notice}
        </div>
      )}

      {editingId !== null && (
        <div className="lf-card space-y-4 ring-brand-200">
          <h2 className="text-lg font-semibold">
            {editingId === "new" ? "Nieuwe gebruiker" : "Gebruiker bewerken"}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="lf-label">Voornaam</label>
              <input
                className="lf-input"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
            </div>
            <div>
              <label className="lf-label">Achternaam</label>
              <input
                className="lf-input"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
            </div>
            <div>
              <label className="lf-label">E-mailadres</label>
              <input
                className="lf-input"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <label className="lf-label">Platformrol</label>
              <select
                className="lf-input"
                value={form.platformRole}
                onChange={(e) =>
                  setForm({ ...form, platformRole: e.target.value as FormState["platformRole"] })
                }
              >
                <option value="USER">Gebruiker</option>
                <option value="PLATFORM_ADMIN">Platform admin</option>
              </select>
            </div>
          </div>
          {editingId === "new" && (
            <p className="text-xs text-slate-500">
              De gebruiker krijgt een uitnodiging per e-mail om een wachtwoord in te stellen.
            </p>
          )}
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
                <th className="py-2 pr-4 font-medium">Naam</th>
                <th className="py-2 pr-4 font-medium">E-mail</th>
                <th className="py-2 pr-4 font-medium">Rol</th>
                <th className="py-2 pr-4 font-medium">2FA</th>
                <th className="py-2 pr-4 font-medium">Leden</th>
                <th className="py-2 pr-4 font-medium">Aangemaakt</th>
                <th className="py-2 pr-4 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 pr-4">
                    {u.firstName} {u.lastName}
                    {u.id === me?.id && <span className="text-xs text-slate-400"> (jij)</span>}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">{u.email}</td>
                  <td className="py-2 pr-4">
                    {u.platformRole === "PLATFORM_ADMIN" ? (
                      <span className="lf-pill bg-purple-100 text-purple-800">Platform admin</span>
                    ) : (
                      <span className="lf-pill bg-slate-200 text-slate-700">Gebruiker</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    {u.twoFactorEnabled ? (
                      <span className="lf-pill bg-emerald-100 text-emerald-800">Aan</span>
                    ) : u.twoFactorRequired ? (
                      <span className="lf-pill bg-amber-100 text-amber-800">Vereist</span>
                    ) : (
                      <span className="lf-pill bg-slate-200 text-slate-600">Uit</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">{u.membershipCount}</td>
                  <td className="py-2 pr-4 text-slate-600 whitespace-nowrap">
                    {fmtDate(u.createdAt)}
                  </td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap space-x-3">
                    <button
                      className="lf-link text-xs"
                      onClick={() => startEdit(u)}
                      disabled={editingId !== null || busy}
                    >
                      Bewerken
                    </button>
                    <button
                      className="lf-link text-xs"
                      onClick={() => resetPassword(u)}
                      disabled={busy}
                    >
                      Reset wachtwoord
                    </button>
                    {u.twoFactorEnabled || u.twoFactorRequired ? (
                      <button
                        className="text-xs text-amber-700 hover:underline"
                        onClick={() => twoFactorAction(u, "disable")}
                        disabled={busy}
                      >
                        2FA uitzetten
                      </button>
                    ) : (
                      <button
                        className="text-xs text-amber-700 hover:underline"
                        onClick={() => twoFactorAction(u, "require")}
                        disabled={busy}
                      >
                        2FA verplichten
                      </button>
                    )}
                    {u.id !== me?.id && (
                      <button
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => remove(u)}
                        disabled={busy}
                      >
                        Verwijderen
                      </button>
                    )}
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

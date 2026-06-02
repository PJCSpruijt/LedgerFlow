import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useScope } from "../contexts/ScopeContext";
import { api } from "../services/api";
import { ErrorNotice } from "../components/ErrorNotice";

type ScopeLevel = "WORKSPACE" | "GROUP" | "ENTITY";
type Role =
  | "WORKSPACE_ADMIN" | "ACCOUNTANT_ADMIN" | "ACCOUNTANT_USER"
  | "CLIENT_ADMIN" | "CLIENT_USER" | "READ_ONLY"
  | "MAPPING_MANAGER" | "CONSOLIDATION_MANAGER";

export const ROLE_LABEL: Record<Role, string> = {
  WORKSPACE_ADMIN: "Werkruimtebeheerder",
  ACCOUNTANT_ADMIN: "Accountant (beheer)",
  ACCOUNTANT_USER: "Accountant",
  CLIENT_ADMIN: "Klant (beheer)",
  CLIENT_USER: "Klant",
  READ_ONLY: "Alleen-lezen",
  MAPPING_MANAGER: "Toewijzingsbeheer",
  CONSOLIDATION_MANAGER: "Consolidatiebeheer",
};
const SCOPE_LABEL: Record<ScopeLevel, string> = { WORKSPACE: "Werkruimte", GROUP: "Groep", ENTITY: "Administratie" };

interface Membership { id: string; scopeLevel: ScopeLevel; role: Role; scopeId: string; scopeName: string }
interface Member { userId: string; email: string; name: string; memberships: Membership[] }
interface AssignableScope { level: ScopeLevel; id: string; name: string; parentName?: string }
interface TeamResult { members: Member[]; scopes: AssignableScope[]; roles: Role[] }

/**
 * Workspace-scoped team & roles. A workspace admin manages who has which role
 * at which scope inside their own workspace (the platform-admin surface stays
 * separate). Backend bounds every change to this workspace.
 */
export function TeamPage() {
  const { workspace } = useScope();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [scopeKey, setScopeKey] = useState(""); // `${level}:${id}`
  const [role, setRole] = useState<Role>("CLIENT_USER");
  const [formErr, setFormErr] = useState<string | null>(null);
  const [formMsg, setFormMsg] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["team", workspace?.id],
    queryFn: () => api<TeamResult>("/api/team/members"),
    enabled: !!workspace,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["team"] });

  const addMut = useMutation({
    mutationFn: (b: { email: string; scopeLevel: ScopeLevel; scopeId: string; role: Role }) =>
      api("/api/team/members", { method: "POST", body: b }),
    onSuccess: () => {
      setEmail(""); setFormErr(null); setFormMsg("Lid toegevoegd."); invalidate();
    },
    onError: (e) => { setFormMsg(null); setFormErr(e instanceof Error ? e.message : "Toevoegen mislukt"); },
  });
  const roleMut = useMutation({
    mutationFn: (b: { id: string; role: Role }) => api(`/api/team/members/${b.id}`, { method: "PATCH", body: { role: b.role } }),
    onSuccess: invalidate,
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => api(`/api/team/members/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });

  const submitAdd = () => {
    setFormErr(null); setFormMsg(null);
    const sc = data?.scopes.find((s) => `${s.level}:${s.id}` === scopeKey) ?? (scopeKey ? null : undefined);
    const scope = scopeKey ? sc : data?.scopes[0];
    if (!email.trim()) { setFormErr("Vul een e-mailadres in."); return; }
    if (!scope) { setFormErr("Kies een niveau."); return; }
    addMut.mutate({ email: email.trim(), scopeLevel: scope.level, scopeId: scope.id, role });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Gebruikers & rollen</h1>
        <p className="text-sm text-slate-500 mt-1">
          Beheer wie toegang heeft tot {workspace?.name ?? "deze werkruimte"} en met welke rol — op werkruimte-, groep- of
          administratieniveau.
        </p>
      </div>

      {!workspace && <div className="lf-card max-w-2xl">Selecteer een werkruimte in de bovenbalk.</div>}
      {workspace && isLoading && <div className="lf-card">Leden laden…</div>}
      {isError && <ErrorNotice error={error} fallback="Kon leden niet laden" onRetry={() => refetch()} />}

      {/* Add member */}
      {data && (
        <div className="lf-card max-w-3xl">
          <h2 className="text-base font-semibold mb-2">Lid toevoegen</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-slate-500">
              E-mailadres
              <input
                className="lf-input h-9 text-sm w-64 block mt-0.5"
                placeholder="naam@bedrijf.nl"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="text-xs text-slate-500">
              Niveau
              <select className="lf-input h-9 text-sm w-56 block mt-0.5" value={scopeKey} onChange={(e) => setScopeKey(e.target.value)}>
                {data.scopes.map((s) => (
                  <option key={`${s.level}:${s.id}`} value={`${s.level}:${s.id}`}>
                    {SCOPE_LABEL[s.level]}: {s.parentName ? `${s.parentName} › ` : ""}{s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-slate-500">
              Rol
              <select className="lf-input h-9 text-sm w-52 block mt-0.5" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {data.roles.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </label>
            <button className="lf-btn-primary text-sm h-9" disabled={addMut.isPending} onClick={submitAdd}>
              Toevoegen
            </button>
          </div>
          {formErr && <div className="text-sm text-red-600 mt-2">{formErr}</div>}
          {formMsg && <div className="text-sm text-emerald-700 mt-2">{formMsg}</div>}
          <p className="text-xs text-slate-400 mt-2">
            De gebruiker moet al een FIN//HUB-account hebben. Nieuwe accounts maakt de platformbeheerder aan.
          </p>
        </div>
      )}

      {/* Members */}
      {data && (
        <div className="lf-card">
          <h2 className="text-base font-semibold mb-2">Leden ({data.members.length})</h2>
          {data.members.length === 0 ? (
            <p className="text-sm text-slate-400">Nog geen leden met een rol in deze werkruimte.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 pr-4">Gebruiker</th>
                  <th className="py-1.5 pr-4">Niveau</th>
                  <th className="py-1.5 pr-4">Bereik</th>
                  <th className="py-1.5 pr-4">Rol</th>
                  <th className="py-1.5 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {data.members.flatMap((m) =>
                  m.memberships.map((ms, i) => (
                    <tr key={ms.id} className="border-b border-slate-50 align-top">
                      <td className="py-1.5 pr-4">
                        {i === 0 ? (
                          <div>
                            <div className="font-medium">{m.name || m.email}</div>
                            <div className="text-xs text-slate-500">{m.email}</div>
                          </div>
                        ) : (
                          <span className="text-slate-300">↳</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-4 text-slate-500">{SCOPE_LABEL[ms.scopeLevel]}</td>
                      <td className="py-1.5 pr-4">{ms.scopeName}</td>
                      <td className="py-1.5 pr-4">
                        <select
                          className="lf-input text-xs h-8 py-0 w-52"
                          value={ms.role}
                          disabled={roleMut.isPending}
                          onChange={(e) => roleMut.mutate({ id: ms.id, role: e.target.value as Role })}
                        >
                          {data.roles.map((r) => (
                            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1.5 pr-4 text-right">
                        <button
                          className="text-xs text-rose-600 hover:underline"
                          disabled={removeMut.isPending}
                          onClick={() => {
                            if (confirm(`Rol van ${m.name || m.email} op ${ms.scopeName} verwijderen?`)) removeMut.mutate(ms.id);
                          }}
                        >
                          Verwijderen
                        </button>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

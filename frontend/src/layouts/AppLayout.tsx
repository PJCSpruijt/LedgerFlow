import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isAdminRole, useScope } from "../contexts/ScopeContext";
import { api } from "../services/api";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/yuki", label: "Yuki-koppeling" },
  { to: "/exports", label: "Excel-exports" },
  { to: "/billing", label: "Abonnement" },
  { to: "/settings", label: "Instellingen" },
];

const adminNavItem = { to: "/admin", label: "Beheer" };

export function AppLayout() {
  const { user, logout } = useAuth();
  const { workspaces, workspace, group, entity, selectWorkspace, selectGroup, selectEntity, reload } =
    useScope();
  const nav = useNavigate();
  const [adding, setAdding] = useState(false);

  const canAddEntity = isAdminRole(group?.role ?? workspace?.role);

  const addAdministration = async () => {
    if (!group || adding) return;
    setAdding(true);
    try {
      const r = await api<{ entity: { id: string; name: string; groupId: string } }>(
        "/api/workspaces/current/entities",
        { method: "POST", body: { name: "Nieuwe administratie", groupId: group.id } },
      );
      await reload();
      selectEntity(r.entity.id);
      nav("/yuki");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="px-6 py-5 border-b border-slate-200">
          <div className="text-lg font-semibold text-slate-900">LedgerFlow</div>
          <div className="text-xs text-slate-500">Finance workflows</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {(user?.platformRole === "PLATFORM_ADMIN" ? [...navItems, adminNavItem] : navItems).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm font-medium ${
                  isActive
                    ? "bg-brand-50 text-brand-700"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-slate-200 space-y-2">
          {workspaces.length > 0 && (
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-slate-400">Werkruimte</span>
              <select
                className="lf-input text-xs"
                value={workspace?.id ?? ""}
                onChange={(e) => selectWorkspace(e.target.value)}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {workspace && workspace.groups.length > 1 && (
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-slate-400">Groep</span>
              <select
                className="lf-input text-xs"
                value={group?.id ?? ""}
                onChange={(e) => selectGroup(e.target.value)}
              >
                {workspace.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {group && group.entities.length > 0 && (
            <label className="block">
              <span className="text-[10px] uppercase tracking-wide text-slate-400">Administratie</span>
              <select
                className="lf-input text-xs"
                value={entity?.id ?? ""}
                onChange={(e) => selectEntity(e.target.value)}
              >
                {group.entities.map((en) => (
                  <option key={en.id} value={en.id}>
                    {en.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {group && canAddEntity && (
            <button
              className="lf-link text-xs px-1 disabled:opacity-50"
              onClick={addAdministration}
              disabled={adding}
            >
              {adding ? "Bezig…" : "+ Administratie toevoegen"}
            </button>
          )}
          <div className="text-xs text-slate-500 px-1">{user?.email}</div>
          <button
            className="lf-btn-secondary w-full text-xs"
            onClick={async () => {
              await logout();
              nav("/login");
            }}
          >
            Uitloggen
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

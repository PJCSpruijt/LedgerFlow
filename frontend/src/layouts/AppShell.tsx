import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isAdminRole, useScope, VIEW_LABELS, type ViewType } from "../contexts/ScopeContext";
import { api } from "../services/api";
import { MODULES, type ModuleDef } from "../navigation/navConfig";
import { useContextUrlSync } from "../navigation/useContextUrlSync";

const VIEW_TYPES = Object.keys(VIEW_LABELS) as ViewType[];

/**
 * FIN//HUB application shell:
 *  - top context bar: brand + global context selectors (workspace / group /
 *    entity / period / currency / view) + utilities
 *  - left module sidebar (generated from navConfig, role-aware)
 *  - per-module sub-navigation tabs + content outlet
 * The right-side detail drawer host is added in a later step.
 */
export function AppShell() {
  const { user, logout } = useAuth();
  const {
    workspaces,
    workspace,
    group,
    entity,
    dateFrom,
    dateTo,
    currency,
    view,
    selectWorkspace,
    selectGroup,
    selectEntity,
    setDateRange,
    setCurrency,
    setView,
    reload,
  } = useScope();
  const nav = useNavigate();
  const { pathname } = useLocation();
  const [adding, setAdding] = useState(false);
  useContextUrlSync();

  const isPlatformAdmin = user?.platformRole === "PLATFORM_ADMIN";
  const modules = MODULES.filter((m) => !m.platformAdminOnly || isPlatformAdmin);
  const activeModule: ModuleDef | undefined =
    modules.find((m) => pathname === m.basePath || pathname.startsWith(m.basePath + "/")) ??
    modules.find((m) => pathname.startsWith(m.basePath));

  const canAddEntity = isAdminRole(group?.role ?? workspace?.role);
  const addAdministration = async () => {
    if (!group || adding) return;
    setAdding(true);
    try {
      const r = await api<{ entity: { id: string } }>("/api/workspaces/current/entities", {
        method: "POST",
        body: { name: "Nieuwe administratie", groupId: group.id },
      });
      await reload();
      selectEntity(r.entity.id);
      nav("/data/connectors");
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* Top context bar */}
      <header className="h-14 flex items-center gap-4 px-4 bg-white border-b border-slate-200">
        <div className="flex items-center gap-2 pr-2 shrink-0">
          <span className="text-lg font-extrabold tracking-tight text-brand-700">FIN//HUB</span>
        </div>

        {workspaces.length > 0 && (
          <select
            className="lf-input text-xs h-9 py-0 w-44"
            value={workspace?.id ?? ""}
            onChange={(e) => selectWorkspace(e.target.value)}
            title="Werkruimte"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        {workspace && workspace.groups.length > 1 && (
          <select
            className="lf-input text-xs h-9 py-0 w-36"
            value={group?.id ?? ""}
            onChange={(e) => selectGroup(e.target.value)}
            title="Groep"
          >
            {workspace.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        )}
        {group && group.entities.length > 0 && (
          <select
            className="lf-input text-xs h-9 py-0 w-44"
            value={entity?.id ?? ""}
            onChange={(e) => selectEntity(e.target.value)}
            title="Administratie"
          >
            {group.entities.map((en) => (
              <option key={en.id} value={en.id}>
                {en.name}
              </option>
            ))}
          </select>
        )}
        {group && canAddEntity && (
          <button
            className="lf-link text-xs whitespace-nowrap disabled:opacity-50"
            onClick={addAdministration}
            disabled={adding}
            title="Administratie toevoegen"
          >
            {adding ? "…" : "+ Adm."}
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1" title="Periode (van / tot)">
            <input
              type="date"
              className="lf-input text-xs h-9 py-0 w-36"
              value={dateFrom}
              max={dateTo}
              onChange={(e) => setDateRange(e.target.value, dateTo)}
            />
            <span className="text-slate-400 text-xs">—</span>
            <input
              type="date"
              className="lf-input text-xs h-9 py-0 w-36"
              value={dateTo}
              min={dateFrom}
              onChange={(e) => setDateRange(dateFrom, e.target.value)}
            />
          </div>
          <select
            className="lf-input text-xs h-9 py-0 w-20"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            title="Valuta"
          >
            {["EUR", "USD", "GBP"].map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            className="lf-input text-xs h-9 py-0 w-40"
            value={view}
            onChange={(e) => setView(e.target.value as ViewType)}
            title="Weergave (databron)"
          >
            {VIEW_TYPES.map((v) => (
              <option key={v} value={v}>
                {VIEW_LABELS[v]}
              </option>
            ))}
          </select>
          <div className="hidden md:flex items-center gap-2 pl-2 border-l border-slate-200">
            <span className="text-xs text-slate-500 max-w-[160px] truncate">{user?.email}</span>
            <button
              className="lf-btn-secondary text-xs h-9 py-0"
              onClick={async () => {
                await logout();
                nav("/login");
              }}
            >
              Uitloggen
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Module sidebar */}
        <aside className="w-52 shrink-0 bg-white border-r border-slate-200 py-3 hidden md:block">
          <nav className="px-2 space-y-1">
            {modules.map((m) => {
              const active = activeModule?.key === m.key;
              return (
                <NavLink
                  key={m.key}
                  to={`${m.basePath}/${m.subpages[0]!.path}`}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
                    active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <span aria-hidden>{m.icon}</span>
                  {m.label}
                </NavLink>
              );
            })}
          </nav>
        </aside>

        {/* Main: sub-nav + content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {activeModule && activeModule.subpages.length > 1 && (
            <div className="bg-white border-b border-slate-200 px-6">
              <div className="flex gap-1 overflow-x-auto">
                {activeModule.subpages.map((sp) => (
                  <NavLink
                    key={sp.path}
                    to={`${activeModule.basePath}/${sp.path}`}
                    className={({ isActive }) =>
                      `px-3 py-3 text-sm whitespace-nowrap border-b-2 -mb-px ${
                        isActive
                          ? "border-brand-600 text-brand-700 font-medium"
                          : "border-transparent text-slate-500 hover:text-slate-800"
                      }`
                    }
                  >
                    {sp.label}
                  </NavLink>
                ))}
              </div>
            </div>
          )}
          <div className="max-w-6xl mx-auto px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

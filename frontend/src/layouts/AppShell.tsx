import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { isAdminRole, useScope, VIEW_LABELS, type ViewType } from "../contexts/ScopeContext";
import { api } from "../services/api";
import { MODULES, type ModuleDef, type SubPage } from "../navigation/navConfig";
import { useContextUrlSync } from "../navigation/useContextUrlSync";
import { UserMenu } from "../components/UserMenu";
import { ProductTour } from "../components/ProductTour";
import { DateRangePicker } from "../components/DateRangePicker";
import { Placeholder } from "../pages/Placeholder";

/** Scaffold subpages (not yet built) render a Placeholder; hidden from non-admins. */
const isScaffold = (sp: SubPage) => sp.element.type === Placeholder;

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
  const { user } = useAuth();
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

  // New-user product tour: auto-show once per user (persisted in localStorage),
  // re-launchable from the user menu.
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (user?.id && !localStorage.getItem(`fh_tour_${user.id}`)) setTourOpen(true);
  }, [user?.id]);
  const closeTour = () => {
    setTourOpen(false);
    if (user?.id) localStorage.setItem(`fh_tour_${user.id}`, "1");
  };

  const isPlatformAdmin = user?.platformRole === "PLATFORM_ADMIN";
  // Subpages a normal user may see: scaffolds are hidden unless platform admin.
  const visibleSubpages = (m: ModuleDef): SubPage[] =>
    isPlatformAdmin ? m.subpages : m.subpages.filter((sp) => !isScaffold(sp));
  // Modules the user may reach (for routing + sub-nav), incl. hidden ones.
  // A module with only scaffold subpages is hidden from non-admins entirely.
  const accessibleModules = MODULES.filter(
    (m) => (!m.platformAdminOnly || isPlatformAdmin) && visibleSubpages(m).length > 0,
  );
  // Sidebar split: regular modules at the top, pinned ones (Platform Admin) at
  // the bottom; modules flagged hideFromSidebar (Instellingen) live in the user menu.
  const sidebarTop = accessibleModules.filter((m) => !m.hideFromSidebar && !m.pinBottom);
  const sidebarBottom = accessibleModules.filter((m) => !m.hideFromSidebar && m.pinBottom);
  const activeModule: ModuleDef | undefined =
    accessibleModules.find((m) => pathname === m.basePath || pathname.startsWith(m.basePath + "/")) ??
    accessibleModules.find((m) => pathname.startsWith(m.basePath));

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
      {tourOpen && <ProductTour modules={accessibleModules} onClose={closeTour} />}
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
          <DateRangePicker value={{ from: dateFrom, to: dateTo }} onChange={setDateRange} />
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
          <div className="flex items-center pl-2 border-l border-slate-200">
            <UserMenu onStartTour={() => setTourOpen(true)} />
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Module sidebar: regular modules at top, Platform Admin pinned bottom */}
        <aside className="w-52 shrink-0 bg-white border-r border-slate-200 py-3 hidden md:flex flex-col justify-between">
          <nav className="px-2 space-y-1">
            {sidebarTop.map((m) => (
              <ModuleLink
                key={m.key}
                m={m}
                active={activeModule?.key === m.key}
                firstPath={visibleSubpages(m)[0]?.path ?? m.subpages[0]!.path}
              />
            ))}
          </nav>
          {sidebarBottom.length > 0 && (
            <nav className="px-2 space-y-1 pt-3 mt-3 border-t border-slate-100">
              {sidebarBottom.map((m) => (
                <ModuleLink
                  key={m.key}
                  m={m}
                  active={activeModule?.key === m.key}
                  firstPath={visibleSubpages(m)[0]?.path ?? m.subpages[0]!.path}
                />
              ))}
            </nav>
          )}
        </aside>

        {/* Main: sub-nav + content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {activeModule &&
            (() => {
              const subs = visibleSubpages(activeModule);
              if (subs.length <= 1) return null;
              return (
                <div className="bg-white border-b border-slate-200 px-6 no-print">
                  <div className="flex gap-1 overflow-x-auto">
                    {subs.map((sp) => (
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
              );
            })()}
          <div className="max-w-[1800px] mx-auto px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function ModuleLink({ m, active, firstPath }: { m: ModuleDef; active: boolean; firstPath: string }) {
  return (
    <NavLink
      to={`${m.basePath}/${firstPath}`}
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium ${
        active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
      }`}
    >
      <span aria-hidden>{m.icon}</span>
      {m.label}
    </NavLink>
  );
}

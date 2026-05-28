import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useOrg } from "../contexts/OrganizationContext";

const navItems = [
  { to: "/dashboard", label: "Dashboard" },
  { to: "/yuki", label: "Yuki-koppeling" },
  { to: "/exports", label: "Excel-exports" },
  { to: "/billing", label: "Abonnement" },
  { to: "/settings", label: "Instellingen" },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const { organizations, current, setCurrent } = useOrg();
  const nav = useNavigate();

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="px-6 py-5 border-b border-slate-200">
          <div className="text-lg font-semibold text-slate-900">LedgerFlow</div>
          <div className="text-xs text-slate-500">Finance workflows</div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map((item) => (
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
          {organizations.length > 0 && (
            <select
              className="lf-input text-xs"
              value={current?.id ?? ""}
              onChange={(e) => setCurrent(e.target.value)}
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
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

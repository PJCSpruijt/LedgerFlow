import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { api } from "../services/api";

interface Subscription {
  planName: string | null;
  status: string | null;
}

function initialsOf(firstName?: string, lastName?: string, email?: string): string {
  const a = (firstName ?? "").trim();
  const b = (lastName ?? "").trim();
  if (a || b) return `${a[0] ?? ""}${b[0] ?? ""}`.toUpperCase() || "?";
  const e = (email ?? "").trim();
  return (e.slice(0, 2) || "?").toUpperCase();
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actief",
  TRIALING: "Proefperiode",
  PAST_DUE: "Betaling te laat",
  CANCELED: "Opgezegd",
  NONE: "Geen abonnement",
};

/**
 * Top-bar account menu: an initials avatar that opens a dropdown with the
 * user's name / e-mail / subscription, a link to Instellingen, and logout.
 */
export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<Subscription | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || user?.email || "";
  const initials = initialsOf(user?.firstName, user?.lastName, user?.email);

  // Load the subscription once, when the menu is first opened.
  useEffect(() => {
    if (!open || sub) return;
    let cancelled = false;
    api<{ subscription: Subscription | null }>("/api/billing/subscription")
      .then((r) => {
        if (!cancelled) setSub(r.subscription ?? { planName: null, status: "NONE" });
      })
      .catch(() => {
        if (!cancelled) setSub({ planName: null, status: "NONE" });
      });
    return () => {
      cancelled = true;
    };
  }, [open, sub]);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        className="h-9 w-9 rounded-full bg-brand-600 text-white text-xs font-semibold flex items-center justify-center hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-300"
        onClick={() => setOpen((o) => !o)}
        title={name}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {initials}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl border border-slate-200 z-50 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="text-sm font-semibold text-slate-800 truncate">{name}</div>
            <div className="text-xs text-slate-500 truncate">{user?.email}</div>
            <div className="mt-2 text-xs">
              <span className="text-slate-400">Abonnement: </span>
              <span className="text-slate-700">
                {sub === null
                  ? "laden…"
                  : `${sub.planName ?? "Geen plan"}${
                      sub.status ? ` · ${STATUS_LABELS[sub.status] ?? sub.status}` : ""
                    }`}
              </span>
            </div>
          </div>
          <nav className="py-1 text-sm">
            <button
              className="w-full text-left px-4 py-2 text-slate-700 hover:bg-slate-50"
              onClick={() => go("/administration/settings")}
            >
              ⚙️ Instellingen
            </button>
            <button
              className="w-full text-left px-4 py-2 text-slate-700 hover:bg-slate-50"
              onClick={() => go("/administration/billing")}
            >
              💳 Facturatie & abonnement
            </button>
          </nav>
          <div className="border-t border-slate-100 py-1">
            <button
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
              onClick={async () => {
                setOpen(false);
                await logout();
                navigate("/login");
              }}
            >
              Uitloggen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

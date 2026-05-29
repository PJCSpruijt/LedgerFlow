import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function AuthLayout() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/dashboard/overview" replace />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-brand-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold tracking-tight text-brand-700">FIN//HUB</h1>
          <p className="text-sm text-slate-500 mt-1">
            Financiële consolidatie &amp; rapportage
          </p>
        </div>
        <div className="lf-card">
          <Outlet />
        </div>
      </div>
    </div>
  );
}

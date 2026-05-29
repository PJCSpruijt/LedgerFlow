import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import { AppLayout } from "./layouts/AppLayout";
import { AuthLayout } from "./layouts/AuthLayout";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { DashboardPage } from "./pages/DashboardPage";
import { SettingsPage } from "./pages/SettingsPage";
import { BillingPage } from "./pages/BillingPage";
import { YukiPage } from "./pages/YukiPage";
import { ExportsPage } from "./pages/ExportsPage";
import { AdminPage } from "./pages/AdminPage";
import { AdminPlansPage } from "./pages/AdminPlansPage";
import { AdminUsersPage } from "./pages/AdminUsersPage";
import { AdminStatsPage } from "./pages/AdminStatsPage";
import { AcceptInvitationPage, ResetPasswordPage } from "./pages/SetPasswordPage";
import { MandatoryTwoFactorPage } from "./pages/MandatoryTwoFactorPage";

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoading />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RequirePlatformAdmin({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (user?.platformRole !== "PLATFORM_ADMIN") return <Navigate to="/dashboard" replace />;
  return children;
}

/**
 * Hard gate: when an admin has mandated 2FA but the user hasn't enrolled, replace
 * the entire app with the blocking enrollment screen — nothing else is reachable.
 */
function Require2FAEnrollment({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (user?.twoFactorRequired && !user.twoFactorEnabled) {
    return <MandatoryTwoFactorPage />;
  }
  return children;
}

function FullScreenLoading() {
  return (
    <div className="flex h-screen items-center justify-center text-slate-500">
      Laden…
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<AuthLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>

      <Route
        element={
          <RequireAuth>
            <Require2FAEnrollment>
              <AppLayout />
            </Require2FAEnrollment>
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/billing" element={<BillingPage />} />
        <Route path="/billing/success" element={<BillingPage />} />
        <Route path="/billing/cancel" element={<BillingPage />} />
        <Route path="/yuki" element={<YukiPage />} />
        <Route path="/exports" element={<ExportsPage />} />
        <Route
          path="/admin"
          element={
            <RequirePlatformAdmin>
              <AdminPage />
            </RequirePlatformAdmin>
          }
        />
        <Route
          path="/admin/plans"
          element={
            <RequirePlatformAdmin>
              <AdminPlansPage />
            </RequirePlatformAdmin>
          }
        />
        <Route
          path="/admin/users"
          element={
            <RequirePlatformAdmin>
              <AdminUsersPage />
            </RequirePlatformAdmin>
          }
        />
        <Route
          path="/admin/stats"
          element={
            <RequirePlatformAdmin>
              <AdminStatsPage />
            </RequirePlatformAdmin>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

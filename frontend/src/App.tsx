import type { ReactElement } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./contexts/AuthContext";
import { AppShell } from "./layouts/AppShell";
import { AuthLayout } from "./layouts/AuthLayout";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
import { BillingPage } from "./pages/BillingPage";
import { AcceptInvitationPage, ResetPasswordPage } from "./pages/SetPasswordPage";
import { MandatoryTwoFactorPage } from "./pages/MandatoryTwoFactorPage";
import { MODULES, LEGACY_REDIRECTS } from "./navigation/navConfig";

function RequireAuth({ children }: { children: ReactElement }) {
  const { user, loading } = useAuth();
  if (loading) return <FullScreenLoading />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RequirePlatformAdmin({ children }: { children: ReactElement }) {
  const { user } = useAuth();
  if (user?.platformRole !== "PLATFORM_ADMIN") return <Navigate to="/dashboard/overview" replace />;
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
    <div className="flex h-screen items-center justify-center text-slate-500">Laden…</div>
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
              <AppShell />
            </Require2FAEnrollment>
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/dashboard/overview" replace />} />

        {/* Module + subpage routes, generated from navConfig. */}
        {MODULES.flatMap((mod) => [
          <Route
            key={`${mod.key}-index`}
            path={mod.basePath}
            element={<Navigate to={`${mod.basePath}/${mod.subpages[0]!.path}`} replace />}
          />,
          ...mod.subpages.map((sp) => (
            <Route
              key={`${mod.key}-${sp.path}`}
              path={`${mod.basePath}/${sp.path}`}
              element={
                mod.platformAdminOnly ? (
                  <RequirePlatformAdmin>{sp.element}</RequirePlatformAdmin>
                ) : (
                  sp.element
                )
              }
            />
          )),
        ])}

        {/* Stripe return URLs (configured in env) must keep resolving to Billing. */}
        <Route path="/billing/success" element={<BillingPage />} />
        <Route path="/billing/cancel" element={<BillingPage />} />

        {/* Legacy path redirects so old links/bookmarks keep working. */}
        {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
          <Route key={from} path={from} element={<Navigate to={to} replace />} />
        ))}
      </Route>

      <Route path="*" element={<Navigate to="/dashboard/overview" replace />} />
    </Routes>
  );
}

import { Navigate, useLocation } from "react-router";
import type { ReactNode } from "react";
import { useAuth } from "./auth-context";

// Reads the destination a guard stashed before bouncing to an auth page, so the
// user lands where they originally intended after signing in or up.
export const resolvePostAuthDestination = (state: unknown): string => {
  const from = (state as { from?: unknown } | null)?.from;
  return typeof from === "string" && from.startsWith("/app") ? from : "/app";
};

const AuthLoadingScreen = () => (
  <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--color-background-secondary)" }}>
    <div
      className="px-4 py-3 rounded-lg border"
      style={{
        borderColor: "var(--color-border-tertiary)",
        background: "var(--color-background-primary)",
        color: "var(--color-text-secondary)",
        fontSize: "13px"
      }}
    >
      Loading session...
    </div>
  </div>
);

export const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { initialized, isAuthenticated } = useAuth();
  const location = useLocation();

  if (!initialized) {
    return <AuthLoadingScreen />;
  }

  if (!isAuthenticated) {
    // New visitors land on sign-up (not sign-in) and keep their destination, so a
    // marketing CTA like "Create your CV" resumes exactly where it pointed.
    return (
      <Navigate
        to="/signup"
        state={{ from: `${location.pathname}${location.search}` }}
        replace
      />
    );
  }

  return <>{children}</>;
};

export const RedirectIfAuthenticated = ({ children }: { children: ReactNode }) => {
  const { initialized, isAuthenticated } = useAuth();
  const location = useLocation();

  if (!initialized) {
    return <AuthLoadingScreen />;
  }

  if (isAuthenticated) {
    return <Navigate to={resolvePostAuthDestination(location.state)} replace />;
  }

  return <>{children}</>;
};

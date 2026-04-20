import { Navigate } from "react-router";
import type { ReactNode } from "react";
import { useAuth } from "./auth-context";

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

  if (!initialized) {
    return <AuthLoadingScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/signin" replace />;
  }

  return <>{children}</>;
};

export const RedirectIfAuthenticated = ({ children }: { children: ReactNode }) => {
  const { initialized, isAuthenticated } = useAuth();

  if (!initialized) {
    return <AuthLoadingScreen />;
  }

  if (isAuthenticated) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
};

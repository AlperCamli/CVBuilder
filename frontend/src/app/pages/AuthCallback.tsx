import { useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "../integration/auth-context";
import { consumePostAuthRedirect } from "../integration/post-auth-redirect";

export function AuthCallback() {
  const navigate = useNavigate();

  const { initialized, isAuthenticated, authMessage } = useAuth();
  useEffect(() => {
    if (!initialized || !isAuthenticated) return;
    navigate(consumePostAuthRedirect() ?? "/app", { replace: true });
  }, [initialized, isAuthenticated, navigate]);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--color-background-secondary)" }}
    >
      <div className="text-center">
        <Loader2
          size={32}
          className="animate-spin mx-auto mb-4"
          style={{ color: "var(--color-teal-600)" }}
        />
        <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
          {initialized && !isAuthenticated
            ? (authMessage ??
              "Your sign-in link couldn't be completed. Please sign in again.")
            : "Completing sign-in..."}
        </p>
        {initialized && !isAuthenticated && (
          <Link to="/signin" className="block mt-4 underline">
            Sign in
          </Link>
        )}
      </div>
    </div>
  );
}

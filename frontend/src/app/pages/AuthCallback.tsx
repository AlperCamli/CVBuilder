import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "../integration/auth-context";
import { consumePostAuthRedirect } from "../integration/post-auth-redirect";
import { trackGoogleSignupCompleted } from "../integration/analytics";

export function AuthCallback() {
  useTranslation();
  const navigate = useNavigate();

  const { initialized, isAuthenticated, authMessage, session } = useAuth();
  // Read through a ref: a token refresh must not re-run the redirect.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  useEffect(() => {
    if (!initialized || !isAuthenticated) return;
    if (sessionRef.current) trackGoogleSignupCompleted(sessionRef.current.user);
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
              t("Your sign-in link couldn't be completed. Please sign in again."))
            : t("Completing sign-in...")}
        </p>
        {initialized && !isAuthenticated && (
          <Link to="/signin" className="block mt-4 underline">
            {t("Sign in")}</Link>
        )}
      </div>
    </div>
  );
}

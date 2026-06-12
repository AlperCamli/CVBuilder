import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { consumePostAuthRedirect } from "../integration/post-auth-redirect";

// Mounted inside the authenticated layout (like CheckoutIntentResumer). Catches
// auth round-trips that re-enter the app without passing through /auth/callback —
// most notably the email-verification link — and resumes the stashed post-signup
// destination the first time the user lands anywhere in /app.
export function PostAuthRedirectResumer() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const destination = consumePostAuthRedirect();
    if (destination && destination !== `${location.pathname}${location.search}`) {
      navigate(destination, { replace: true });
    }
    // Intentionally run once per layout mount; the stash is cleared on consume.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

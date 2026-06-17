import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Loader2 } from "lucide-react";
import { useAuth } from "../integration/auth-context";
import { startStripeCheckout } from "../integration/checkout-redirect";
import { clearPendingCheckout, readPendingCheckout } from "../integration/pending-checkout";

// Mounted inside the authenticated layout. When a visitor picked a paid plan on
// the public pricing page before signing up, the choice was stashed in
// localStorage. The moment they arrive authenticated (after sign-up, email
// verification, or Google OAuth — all of which land in /app) this resumes the
// flow straight into Stripe Checkout, so the journey feels like one continuous
// step instead of "sign up, then go hunt for the upgrade button again".
export function CheckoutIntentResumer() {
  const { api, isAuthenticated } = useAuth();
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || startedRef.current) {
      return;
    }

    const intent = readPendingCheckout();
    if (!intent) {
      return;
    }

    startedRef.current = true;
    // Clear up-front so a cancelled or failed attempt can't loop on the next render.
    clearPendingCheckout();
    setActive(true);

    void (async () => {
      try {
        await startStripeCheckout(api, intent.plan_code, {
          withTrial: intent.with_trial,
          source: "post_signup_checkout_resume"
        });
        // On success the browser is already navigating away to Stripe.
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "We couldn't open checkout. You can try again from the pricing page."
        );
      }
    })();
  }, [api, isAuthenticated]);

  if (!active) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-6"
      style={{ background: "var(--color-background-secondary)" }}
      role="status"
      aria-live="polite"
    >
      <div className="text-center max-w-sm">
        {error ? (
          <>
            <p className="font-medium mb-2" style={{ fontSize: "16px", color: "var(--color-text-primary)" }}>
              Checkout didn't open
            </p>
            <p className="mb-5" style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
              {error}
            </p>
            <Link
              to="/app/pricing"
              onClick={() => setActive(false)}
              className="interactive-button inline-block px-5 py-2.5 rounded-lg font-medium"
              style={{ fontSize: "13px", background: "var(--color-teal-600)", color: "var(--color-teal-50)" }}
            >
              Go to pricing
            </Link>
          </>
        ) : (
          <>
            <Loader2 size={32} className="animate-spin mx-auto mb-4" style={{ color: "var(--color-teal-600)" }} />
            <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
              Taking you to secure checkout…
            </p>
          </>
        )}
      </div>
    </div>
  );
}

import type { CheckoutTarget } from "../../content/pricing";

// Persists a checkout the user kicked off from the public pricing page before
// signing up. It must survive the full sign-up round-trip (including the email
// verification redirect and Google OAuth), so it lives in localStorage rather
// than in-memory or router state. Once the user lands authenticated in /app the
// CheckoutIntentResumer reads it, sends them to Stripe, and clears it.
export interface PendingCheckoutIntent {
  plan_code: CheckoutTarget;
  with_trial?: boolean;
}

const STORAGE_KEY = "cv-builder:pending-checkout";

const isCheckoutTarget = (value: unknown): value is CheckoutTarget =>
  value === "pro" || value === "lifetime";

export function setPendingCheckout(intent: PendingCheckoutIntent): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // Storage may be unavailable (private mode); the flow simply won't resume.
  }
}

export function readPendingCheckout(): PendingCheckoutIntent | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!isCheckoutTarget(parsed.plan_code)) {
      return null;
    }

    return {
      plan_code: parsed.plan_code,
      with_trial: typeof parsed.with_trial === "boolean" ? parsed.with_trial : undefined
    };
  } catch {
    return null;
  }
}

export function clearPendingCheckout(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // no-op
  }
}

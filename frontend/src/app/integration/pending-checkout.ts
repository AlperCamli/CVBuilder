import type { CheckoutTarget } from "../../content/pricing";
import { isCheckoutTarget, TRIAL_PLAN } from "../../content/pricing";
import { safeReturnPath } from "./subscription-flow";

// Restores an explicitly selected plan across signup, verification and OAuth.
// Only the dedicated checkout route starts payment; unrelated navigation never
// consumes this choice. The pending choice expires after 24 hours. A trial intent always resumes on the trial plan
// ("trial wins"): a { plan_code: "weekly", with_trial: true } stored before the trial moved to Monthly becomes a
// Monthly trial, never an immediate weekly charge.
export interface PendingCheckoutIntent {
  plan_code: CheckoutTarget;
  with_trial?: boolean;
  return_path?: string;
  /** A ?promo= link token for this plan (only set for a plan the offer covers). */
  promotion_token?: string;
}

const STORAGE_KEY = "cv-builder:pending-checkout";

export function setPendingCheckout(intent: PendingCheckoutIntent): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...intent, created_at: Date.now() }));
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
    if (!isCheckoutTarget(parsed.plan_code) || (typeof parsed.created_at === "number" && Date.now() - parsed.created_at > 86400000)) {
      return null;
    }

    // A record without the flag predates the explicit boolean. On Weekly, the trial plan of that time, it meant the
    // trial (the backend reads an omitted with_trial on Weekly the same way), so it must never resume as a charge.
    const withTrial = typeof parsed.with_trial === "boolean" ? parsed.with_trial : parsed.plan_code === "weekly" ? true : undefined;
    return {
      plan_code: withTrial === true ? TRIAL_PLAN : parsed.plan_code,
      ...(typeof parsed.return_path === "string" ? { return_path: safeReturnPath(parsed.return_path) } : {}),
      with_trial: withTrial,
      ...(typeof parsed.promotion_token === "string" && /^[A-Za-z0-9_-]{1,256}$/.test(parsed.promotion_token) ? { promotion_token: parsed.promotion_token } : {})
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

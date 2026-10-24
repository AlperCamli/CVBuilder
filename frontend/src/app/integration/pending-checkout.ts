import type { CheckoutTarget } from "../../content/pricing";
import { isCheckoutTarget } from "../../content/pricing";
import { safeReturnPath } from "./subscription-flow";

// Restores an explicitly selected plan across signup, verification and OAuth.
// Only the dedicated checkout route starts payment; unrelated navigation never
// consumes this choice. The pending choice expires after 24 hours.
export interface PendingCheckoutIntent {
  plan_code: CheckoutTarget;
  with_trial?: boolean;
  return_path?: string;
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

    return {
      plan_code: parsed.plan_code,
      ...(typeof parsed.return_path === "string" ? { return_path: safeReturnPath(parsed.return_path) } : {}),
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

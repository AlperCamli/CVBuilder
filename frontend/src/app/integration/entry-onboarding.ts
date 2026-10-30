import { CV_START_PATH } from "../design-tools";
import type { MeResponseData } from "./api-types";

// Pages a new account may open before finishing onboarding: the handoff and its
// result, billing (the pricing purchase flow signs up first) and account settings.
const EXEMPT_APP_PATH = /^\/app\/(onboarding|cv-score|checkout|pricing|profile)(?:\/|$)/;

// Only an explicit null gates: the field is absent until the backend migration runs.
export function needsEntryOnboarding(me: MeResponseData | null): boolean {
  return me?.user.entry_onboarding_completed_at === null;
}

// Accounts created through /signin, a deep link or another device's verification
// link still go through the onboarding before the rest of the app (and its paywall).
export function entryOnboardingRedirect(pathname: string, me: MeResponseData | null): string | null {
  return needsEntryOnboarding(me) && !EXEMPT_APP_PATH.test(pathname) ? CV_START_PATH : null;
}

// Fresh visitors sign up at the end of the onboarding. The standalone form only
// serves an explicit destination: a protected deep link or the pricing purchase flow.
export function signupOnboardingRedirect(state: unknown, search: string): string | null {
  const from = (state as { from?: unknown } | null)?.from;
  const explicit = typeof from === "string" && from.startsWith("/app");
  return explicit || new URLSearchParams(search).get("purchase") === "1" ? null : CV_START_PATH;
}

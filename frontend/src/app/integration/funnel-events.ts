import { integrationConfig } from "./config";

// Anonymous first-party funnel counters. Each call adds 1 to a daily aggregate on the
// backend (POST /funnel-events). No cookies, device storage, identifiers or free text,
// so it is recorded for every visitor regardless of analytics consent; GA4 stays opt-in.
export const FUNNEL_EVENTS = [
  "landing_view",
  "pricing_view",
  "cta_click", // detail: header | hero | final | mascot | pricing_trial | pricing_pro | template | demo_export
  "onboarding_upload_view",
  "onboarding_upload_started",
  "onboarding_upload_completed",
  "onboarding_upload_failed",
  "onboarding_manual_create",
  "onboarding_question_view", // detail: goal | career_stage | education | source
  "onboarding_signup_view",
  "onboarding_score_preview", // detail: scored | unscored | image_based
  "signup_completed", // detail: google | email
  "email_verification_required",
  "score_view",
  "score_action", // detail: editor | tailor | improve
  "free_tailoring_started",
  "free_tailoring_finished",
  "free_improve_used",
  "paywall_shown", // detail: export | ai | tailoring | cover_letter | other
  "checkout_view", // detail: trial | pro
  "checkout_redirect", // detail: trial | pro
  "checkout_success", // detail: trial | pro
  "checkout_canceled",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

const DETAIL_RE = /^[a-z][a-z0-9_]{0,31}$/;
const UTM_RE = /^[a-z0-9][a-z0-9_.-]{0,39}$/;
const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|inspectiontool/i;

// Kept in memory only, so the landing page's campaign also attributes later steps of the same page session.
let sessionUtm: string | undefined;

function utmSource(): string | undefined {
  const value = new URLSearchParams(window.location.search).get("utm_source")?.trim().toLowerCase();
  if (value && UTM_RE.test(value)) sessionUtm = value;
  return sessionUtm;
}

export function trackFunnelEvent(event: FunnelEvent, detail?: string): void {
  if (typeof window === "undefined" || !window.navigator || BOT_RE.test(window.navigator.userAgent ?? "")) return;
  const body = JSON.stringify({
    event,
    detail: detail && DETAIL_RE.test(detail) ? detail : undefined,
    locale: window.location.pathname === "/tr" || window.location.pathname.startsWith("/tr/") || document.documentElement.lang === "tr" ? "tr" : "en",
    device: window.matchMedia?.("(max-width: 767px)").matches ? "mobile" : "desktop",
    utm_source: utmSource(),
  });
  const url = `${integrationConfig.apiBaseUrl}/funnel-events`;
  try {
    if (navigator.sendBeacon?.(url, new Blob([body], { type: "application/json" }))) return;
    void fetch(url, { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true, credentials: "omit" }).catch(() => {});
  } catch {
    // Counting must never break the page.
  }
}

// Landing and pricing views count once per page load: the remembered-locale redirect (/ <-> /tr,
// /pricing <-> /tr/pricing) re-renders the page under a new path and must not count it again. A
// later in-app move to the other page (landing -> pricing) still counts that page once.
const countedPageViews = new Set<"landing_view" | "pricing_view">();

export function trackPageViewOnce(event: "landing_view" | "pricing_view"): void {
  if (countedPageViews.has(event)) return;
  countedPageViews.add(event);
  trackFunnelEvent(event);
}

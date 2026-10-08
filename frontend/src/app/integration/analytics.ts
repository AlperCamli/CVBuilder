import { analyticsAllowed, PRIVACY_EVENT, CONSENT_KEY, getPrivacyConfig } from "./privacy";
import { analyticsPage, type AnalyticsPage } from "./analytics-pages";
type AnalyticsValue = string | number | boolean | null | undefined;

export type AnalyticsParams = Record<string, AnalyticsValue>;

type GtagCommand =
  | ["consent", "default", AnalyticsParams]
  | ["consent", "update", AnalyticsParams]
  | ["js", Date]
  | ["config", string, AnalyticsParams?]
  | ["event", string, AnalyticsParams?];

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: GtagCommand) => void;
  }
}

const GA_MEASUREMENT_ID = (import.meta.env.VITE_GA_MEASUREMENT_ID ?? "").trim();
let analyticsReady = false;
let initializing: Promise<void> | null = null;
let generation = 0;
let currentPage: AnalyticsPage | null = null;
let currentPathname = "";
let pageSequence = 0;
let lastQueuedPage = -1;
type PendingEvent = { name: string; params: AnalyticsParams; at: number };
let pendingEvents: PendingEvent[] = [];
const MAX_PENDING_EVENTS = 100;
const EVENT_MAX_AGE_MS = 60_000;
const GA_SCRIPT_ID = "ga4-google-tag";
const CHECKOUT_ATTRIBUTION_KEY = "analytics:checkout-attribution";
const PAYMENT_COMPLETED_PREFIX = "analytics:payment-completed";
const CRAWLER_USER_AGENT_RE =
  /Googlebot|Google-InspectionTool|AdsBot-Google|Mediapartners-Google|bingbot|DuckDuckBot|Slurp|YandexBot|Baiduspider/i;

export const GA4_KEY_EVENT_RECOMMENDATIONS = [
  "tailored_cv_generated",
  "cv_exported",
  "payment_completed",
  "signup_page_view"
] as const;

export type CheckoutAttribution = {
  checkout_session_id?: string;
  plan_code?: string;
  plan_name?: string;
  trial_applied?: boolean;
  trial_period_days?: number | null;
  value?: number;
  currency?: string;
};

const hasWindow = (): boolean => typeof window !== "undefined";

const shouldSkipAnalytics = (): boolean =>
  !hasWindow() || !analyticsAllowed() || !analyticsReady || CRAWLER_USER_AGENT_RE.test(window.navigator.userAgent);

const SAFE_PARAMS = new Set(["step", "question", "file_extension", "file_mime_type", "file_size_bucket", "file_type", "answered_questions", "plan_code", "plan_name", "trial_applied", "trial_period_days", "value", "currency", "cv_kind", "format", "source", "cta_index", "article_slug", "category_slug"]);
SAFE_PARAMS.add("action");
for (const key of ["flow", "surface", "path_selected", "method", "verification_required", "skipped", "completed_steps", "onboarding_completed_before", "module_type", "parse_status", "parse_quality", "parse_needs_manual_review", "parser_name", "page_count", "section_count", "block_count", "master_cv_loaded", "generated_question_count", "answered_follow_up_count", "selected_keyword_count", "selected_topic_count", "has_company", "has_job_posting_url", "has_location", "has_notes", "has_role", "has_template", "pasted_character_count", "download_available", "export_status", "has_redirect_state", "result"]) SAFE_PARAMS.add(key);
const cleanParams = (params: AnalyticsParams = {}): AnalyticsParams =>
  Object.fromEntries(
    Object.entries(params).filter(([key, value]) => SAFE_PARAMS.has(key) && value !== undefined && value !== null)
      .map(([key, value]) => [key, key === "source" && typeof value === "string" && value.startsWith("/") ? analyticsPage(value)?.path ?? "other" : value])
      .filter(([, value]) => typeof value !== "string" || (value.length <= 128 && !value.includes("@") && !/https?:|[?#]|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}/i.test(value)))
  );

function pageParams(page = currentPage): AnalyticsParams {
  return { page_location: window.location.origin + (page?.path ?? "/screens/other"), page_referrer: "", page_title: page?.title ?? "CV Builder" };
}
function queueEvent(name: string, params: AnalyticsParams) {
  pendingEvents = pendingEvents.filter(event => Date.now() - event.at < EVENT_MAX_AGE_MS);
  if (pendingEvents.length >= MAX_PENDING_EVENTS) pendingEvents.shift();
  pendingEvents.push({name, params, at: Date.now()});
}
function flushEvents() {
  if (shouldSkipAnalytics() || !document.getElementById(GA_SCRIPT_ID)) return;
  const events = pendingEvents; pendingEvents = [];
  for (const event of events) {
    if (!analyticsAllowed()) break;
    if (Date.now() - event.at < EVENT_MAX_AGE_MS) window.gtag?.("event", event.name, event.params);
  }
}

export function trackPageView(pathname: string): void {
  if (!hasWindow() || pathname === currentPathname) return;
  currentPathname = pathname; currentPage = analyticsPage(pathname); pageSequence++;
  if (!currentPage || !analyticsAllowed() || !GA_MEASUREMENT_ID) return;
  lastQueuedPage = pageSequence;
  queueEvent("page_view", pageParams());
  if (analyticsReady) {
    window.gtag?.("config", GA_MEASUREMENT_ID, {send_page_view: false, ...pageParams()});
    flushEvents();
  } else scheduleAnalytics();
}

const normalizePlanValue = (planCode?: string, trialApplied?: boolean): number | undefined => {
  if (planCode === "lifetime") return 99;
  if (planCode === "pro") return trialApplied ? 0 : 10;
  if (planCode === "weekly") return trialApplied ? 0 : 4.99;
  if (planCode === "monthly") return 14.99;
  if (planCode === "annual") return 99.9;
  return undefined;
};

export function initializeAnalytics(): void {
  if (shouldSkipAnalytics() || !GA_MEASUREMENT_ID) return;

  if (document.getElementById(GA_SCRIPT_ID)) return;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag =
    window.gtag ??
    function gtag(..._args: GtagCommand): void {
      window.dataLayer?.push(arguments);
    };

  if (!document.getElementById(GA_SCRIPT_ID)) {
    const script = document.createElement("script");
    script.id = GA_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`;
    script.onerror = () => { if (document.getElementById(GA_SCRIPT_ID) === script) { script.remove(); analyticsReady = false; } };
    document.head.appendChild(script);
  }

  window.gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  window.gtag("js", new Date());
  window.gtag("config", GA_MEASUREMENT_ID, {
    send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
    ...pageParams()
  });
}

export function scheduleAnalytics(): void {
  if (!hasWindow() || !currentPage || !GA_MEASUREMENT_ID || !analyticsAllowed() || initializing || CRAWLER_USER_AGENT_RE.test(window.navigator.userAgent)) return;
  const attempt = generation;
  const request = getPrivacyConfig().then(config => {
    if (attempt !== generation || !analyticsAllowed() || !currentPage) return;
    analyticsReady = config.analytics_enabled === true;
    if (!analyticsReady) { const active = !!document.getElementById(GA_SCRIPT_ID); removeAnalyticsData(); if (active) window.location.reload(); return; }
    initializeAnalytics();
    // Acceptance on an already open screen must capture that screen, without
    // replaying any rejected/pre-consent interactions.
    if (currentPage && lastQueuedPage !== pageSequence) {
      lastQueuedPage = pageSequence;
      pendingEvents.unshift({name: "page_view", params: pageParams(), at: Date.now()});
    }
    flushEvents();
  }).catch(() => { if (attempt === generation) analyticsReady = false; }).finally(() => { if (initializing === request) initializing = null; });
  initializing = request;
}

export function trackEvent(eventName: string, params: AnalyticsParams = {}): void {
  if (!hasWindow() || !analyticsAllowed() || !GA_MEASUREMENT_ID || CRAWLER_USER_AGENT_RE.test(window.navigator.userAgent) || !/^[a-z][a-z0-9_]{0,39}$/.test(eventName) || !currentPage) return;
  queueEvent(eventName, {...pageParams(), ...cleanParams(params)});
  if (!analyticsReady) scheduleAnalytics();
  else { initializeAnalytics(); flushEvents(); }
}

export function trackBlogCtaClick(params: {
  article_slug: string;
  category_slug: string;
  cta_index: number;
  cta_text: string;
  destination: string;
}): void {
  trackEvent("blog_cta_click", params);
}

export function trackSignupPageView(params: AnalyticsParams = {}): void {
  trackEvent("signup_page_view", params);
}

export function trackCvUploadStarted(params: AnalyticsParams = {}): void {
  trackEvent("cv_upload_started", params);
}

export function trackCvUploadCompleted(params: AnalyticsParams = {}): void {
  trackEvent("cv_upload_completed", params);
}

export function trackJobDescriptionPasted(params: AnalyticsParams = {}): void {
  trackEvent("job_description_pasted", params);
}

export function trackTailoredCvGenerated(params: AnalyticsParams = {}): void {
  trackEvent("tailored_cv_generated", params);
}

export function trackCvExported(params: AnalyticsParams = {}): void {
  trackEvent("cv_exported", params);
}

export function trackPaymentStarted(params: AnalyticsParams = {}): void {
  trackEvent("payment_started", params);
}

export function trackPaymentCompleted(params: AnalyticsParams = {}): void {
  trackEvent("payment_completed", params);
}

export function trackOnboardingStepView(params: AnalyticsParams = {}): void {
  trackEvent("onboarding_step_view", params);
}

export function trackOnboardingStepCompleted(params: AnalyticsParams = {}): void {
  trackEvent("onboarding_step_completed", params);
}

export function trackOnboardingPathSelected(params: AnalyticsParams = {}): void {
  trackEvent("onboarding_path_selected", params);
}

export function trackOnboardingSkipped(params: AnalyticsParams = {}): void {
  trackEvent("onboarding_skipped", params);
}

export function trackPostExportPaywallView(params: AnalyticsParams = {}): void {
  trackEvent("post_export_paywall_view", params);
}

export function trackPostExportPaywallPlanClick(params: AnalyticsParams = {}): void {
  trackEvent("post_export_paywall_plan_click", params);
}

export function trackPostExportPaywallDismissed(params: AnalyticsParams = {}): void {
  trackEvent("post_export_paywall_dismissed", params);
}

export function fileAnalyticsParams(file: Pick<File, "name" | "size" | "type">): AnalyticsParams {
  const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : "unknown";
  const sizeMb = file.size / (1024 * 1024);
  const sizeBucket =
    sizeMb < 1 ? "under_1mb" : sizeMb < 5 ? "1_5mb" : sizeMb < 10 ? "5_10mb" : "over_10mb";

  return {
    file_extension: extension || "unknown",
    file_mime_type: file.type || "unknown",
    file_size_bucket: sizeBucket
  };
}

export function rememberCheckoutAttribution(params: CheckoutAttribution): void {
  if (!hasWindow() || !analyticsAllowed()) return;

  const value = params.value ?? normalizePlanValue(params.plan_code, params.trial_applied);
  const payload: CheckoutAttribution = {
    ...params,
    ...(value !== undefined ? { value, currency: params.currency ?? "USD" } : {})
  };

  window.sessionStorage.setItem(CHECKOUT_ATTRIBUTION_KEY, JSON.stringify(payload));
}

export function readCheckoutAttribution(): CheckoutAttribution | null {
  if (!hasWindow() || !analyticsAllowed()) return null;

  const raw = window.sessionStorage.getItem(CHECKOUT_ATTRIBUTION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as CheckoutAttribution;
  } catch {
    return null;
  }
}

export function clearCheckoutAttribution(): void {
  if (!hasWindow()) return;
  window.sessionStorage.removeItem(CHECKOUT_ATTRIBUTION_KEY);
}

export function paymentCompletedTrackingKey(attribution: CheckoutAttribution | null): string {
  return `${PAYMENT_COMPLETED_PREFIX}:${attribution?.checkout_session_id ?? "unknown"}`;
}

export function hasTrackedPaymentCompleted(key: string): boolean {
  if (!hasWindow() || !analyticsAllowed()) return false;
  return window.sessionStorage.getItem(key) === "true";
}

export function markPaymentCompletedTracked(key: string): void {
  if (!hasWindow() || !analyticsAllowed()) return;
  window.sessionStorage.setItem(key, "true");
}


export function removeAnalyticsData() {
  if (!hasWindow()) return;
  generation++; initializing = null; analyticsReady = false; pendingEvents = []; lastQueuedPage = -1;
  (window as unknown as Record<string, unknown>)[`ga-disable-${GA_MEASUREMENT_ID}`] = true;
  window.gtag?.("consent", "update", { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  document.getElementById(GA_SCRIPT_ID)?.remove();
  window.dataLayer = [];
  const hostname = window.location.hostname.split(".");
  const domains = ["", ...hostname.map((_, index) => "." + hostname.slice(index).join("."))];
  const paths = ["/", ...window.location.pathname.split("/").filter(Boolean).map((_, index, parts) => "/" + parts.slice(0, index + 1).join("/"))];
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0].trim();
    if (!/^(_ga(?:_|$)|_gid$|_gat(?:_|$))/.test(name)) continue;
    for (const domain of domains) for (const path of paths) document.cookie = `${name}=; Max-Age=0; path=${path}${domain ? "; domain=" + domain : ""}`;
  }
  for (const name of ["localStorage", "sessionStorage"] as const) {
    try {
      const storage = window[name];
      for (let index = storage.length - 1; index >= 0; index--) {
        const key = storage.key(index)!;
        if (key.startsWith("analytics:") || key.startsWith("_ga")) storage.removeItem(key);
      }
    } catch {
      // Tracking is still disabled when a browser denies storage access.
    }
  }
}
export function installAnalyticsConsentListener() {
  if (!hasWindow()) return;
  const update = () => {
    if (analyticsAllowed()) { (window as unknown as Record<string, unknown>)[`ga-disable-${GA_MEASUREMENT_ID}`] = false; scheduleAnalytics(); }
    else { const active = !!document.getElementById(GA_SCRIPT_ID); removeAnalyticsData(); if (active) window.location.reload(); }
  };
  window.addEventListener(PRIVACY_EVENT, update);
  window.addEventListener("online", update);
  window.addEventListener("storage", event => { if (event.key === CONSENT_KEY || event.key === null) update(); });
  if (!analyticsAllowed()) removeAnalyticsData();
  window.setInterval(update, 60_000);
}

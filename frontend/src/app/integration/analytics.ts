type AnalyticsValue = string | number | boolean | null | undefined;

export type AnalyticsParams = Record<string, AnalyticsValue>;

type GtagCommand =
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
  !hasWindow() || CRAWLER_USER_AGENT_RE.test(window.navigator.userAgent);

const cleanParams = (params: AnalyticsParams = {}): AnalyticsParams =>
  Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null)
  );

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
    document.head.appendChild(script);
  }

  window.gtag("js", new Date());
  window.gtag("config", GA_MEASUREMENT_ID);
}

export function scheduleAnalytics(): void {
  if (shouldSkipAnalytics() || !GA_MEASUREMENT_ID) return;

  const start = () => initializeAnalytics();
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(start, { timeout: 3000 });
    return;
  }

  window.setTimeout(start, 1500);
}

export function trackEvent(eventName: string, params: AnalyticsParams = {}): void {
  if (shouldSkipAnalytics() || !GA_MEASUREMENT_ID) return;

  if (!window.gtag) {
    initializeAnalytics();
  }

  window.gtag?.("event", eventName, cleanParams(params));
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
  if (!hasWindow()) return;

  const value = params.value ?? normalizePlanValue(params.plan_code, params.trial_applied);
  const payload: CheckoutAttribution = {
    ...params,
    ...(value !== undefined ? { value, currency: params.currency ?? "USD" } : {})
  };

  window.sessionStorage.setItem(CHECKOUT_ATTRIBUTION_KEY, JSON.stringify(payload));
}

export function readCheckoutAttribution(): CheckoutAttribution | null {
  if (!hasWindow()) return null;

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
  if (!hasWindow()) return false;
  return window.sessionStorage.getItem(key) === "true";
}

export function markPaymentCompletedTracked(key: string): void {
  if (!hasWindow()) return;
  window.sessionStorage.setItem(key, "true");
}

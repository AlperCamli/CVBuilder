import type { BillingPlanResponseData, MeResponseData } from "./api-types";
import type { CheckoutTarget } from "../../content/pricing";

export const ONBOARDING_ENTRY_PATH = "/onboarding?step=upload";
export function hasAppAccess(plan: Pick<BillingPlanResponseData, "plan_code" | "subscription_status" | "app_access">): boolean {
  return plan.app_access ?? (plan.plan_code !== "free" && ["active", "trialing"].includes(plan.subscription_status));
}

// A renewal failed: Stripe keeps the subscription, so the fix is the billing portal, not a new checkout.
export function hasBillingIssue(plan: Pick<BillingPlanResponseData, "subscription_status" | "provider"> | null | undefined): boolean {
  return Boolean(plan?.provider?.provider_subscription_id) && ["past_due", "unpaid", "paused"].includes(plan!.subscription_status);
}

// The paywall that opened checkout (contract with the paywalls: /app/checkout?trial=1&source=…&next=…).
export const CHECKOUT_SOURCES = ["export", "ai", "tailoring", "cover_letter"] as const;
export type CheckoutSource = (typeof CHECKOUT_SOURCES)[number];
export function checkoutSource(value: unknown): CheckoutSource | null {
  return CHECKOUT_SOURCES.includes(value as CheckoutSource) ? value as CheckoutSource : null;
}

// Accounts that finished the entry onboarding return to the app, not to its upload step.
export function resolveReturnPath(path: string, me: Pick<MeResponseData, "user"> | null): string {
  return path === ONBOARDING_ENTRY_PATH && me?.user.entry_onboarding_completed_at ? "/app" : path;
}

export function pricingPath(options: { return_path?: string; source?: CheckoutSource | null } = {}): string {
  const params = new URLSearchParams();
  if (options.return_path) params.set("next", safeReturnPath(options.return_path));
  if (options.source) params.set("source", options.source);
  const query = params.toString();
  return query ? `/app/pricing?${query}` : "/app/pricing";
}

export function canOpenExistingCvWorkspace(path: string): boolean {
  return /^\/app\/?$/.test(path) || path === "/app/resumes" || /^\/app\/cv\/[\da-f-]{36}\/?$/.test(path);
}

export function safeReturnPath(path: unknown, fallback = ONBOARDING_ENTRY_PATH): string {
  if (typeof path !== "string" || path.length > 1600 || /[\\\r\n]/.test(path)) return fallback;
  // Internal destinations only. Never permit a checkout return to itself.
  if (!/^\/(app(?:\/|\?|$)|onboarding(?:\?|$))/.test(path) || /^\/app\/checkout(?:[/?]|$)/.test(path)) return fallback;
  return path;
}

export function checkoutPath(options: { plan_code?: CheckoutTarget; with_trial?: boolean; return_path?: string; auto?: boolean; source?: CheckoutSource | null } = {}): string {
  const params = new URLSearchParams({ plan: options.plan_code ?? "weekly", trial: options.with_trial === false ? "0" : "1" });
  const source = checkoutSource(options.source);
  if (source) params.set("source", source);
  params.set("next", safeReturnPath(options.return_path));
  if (options.auto) params.set("auto", "1");
  return `/app/checkout?${params}`;
}

const TEMPLATE_KEY = "cv-builder:onboarding-template";
export function rememberOnboardingTemplate(slug: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,100}$/.test(slug)) return;
  try { window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify({ slug, expires_at: Date.now() + 86400000 })); } catch { /* URL keeps the selection through the first step. */ }
}
export function onboardingTemplateName(slug: string): string {
  return ({ "horizon-rail": "Horizon", "studio-banner-ocean": "Studio Ocean", "mosaic-columns-rose": "Mosaic Rose", "editorial-index-graphite": "Editorial Graphite", "mosaic-columns-graphite": "Mosaic Graphite", "ledger-split": "Ledger", "latex-academic-serif": "Academic Serif" } as Record<string, string>)[slug] ?? slug.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
export function readOnboardingTemplate(): string | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(TEMPLATE_KEY) ?? "null");
    return typeof value?.slug === "string" && /^[a-z0-9][a-z0-9-]{0,100}$/.test(value.slug) && value.expires_at > Date.now() ? value.slug : null;
  } catch { return null; }
}

export function clearOnboardingTemplate(): void {
  try { window.localStorage.removeItem(TEMPLATE_KEY); } catch { /* Optional preference. */ }
}

export async function applyOnboardingTemplate(api: Pick<import("./backend-api").BackendApi, "listTemplates" | "patchMasterCvTemplate">, cvId: string, moduleType = "standard"): Promise<void> {
  const slug = readOnboardingTemplate();
  if (!slug) return;
  const { templates } = await api.listTemplates(moduleType);
  const template = templates.find(item => item.slug === slug && item.status === "active");
  if (!template) throw new Error("Your selected template is unavailable. Please select another template before continuing.");
  await api.patchMasterCvTemplate(cvId, template.id);
  // Keep the selection for retrying a score action and the AI-improved version.
}

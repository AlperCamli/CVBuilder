import type { BillingPlanResponseData, MeResponseData } from "./api-types";
import { isCheckoutTarget, TRIAL_PLAN, type CheckoutTarget } from "../../content/pricing";

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

// with_trial omitted: a trial only without a plan or for the trial plan itself ({} → Monthly trial,
// { plan_code: "annual" } → paid Annual). An explicit trial is always the trial plan's ("trial wins"): an old
// { plan_code: "weekly", with_trial: true } intent becomes a Monthly trial, never an immediate weekly charge.
// with_trial: false without a plan is paid Monthly.
export function checkoutPath(options: { plan_code?: CheckoutTarget; with_trial?: boolean; return_path?: string; auto?: boolean; source?: CheckoutSource | null } = {}): string {
  const wantsTrial = options.with_trial ?? (options.plan_code === undefined || options.plan_code === TRIAL_PLAN);
  const plan = wantsTrial ? TRIAL_PLAN : options.plan_code ?? TRIAL_PLAN;
  const params = new URLSearchParams({ plan, trial: wantsTrial ? "1" : "0" });
  const source = checkoutSource(options.source);
  if (source) params.set("source", source);
  params.set("next", safeReturnPath(options.return_path));
  if (options.auto) params.set("auto", "1");
  return `/app/checkout?${params}`;
}

/**
 * Checkout after the billing portal found no Stripe customer for the account: the trial screen when the account can
 * still start a trial (no automatic handoff, so nothing is charged without the user seeing it), else the plan asked
 * for or held (the trial plan if none), paid, handed straight to Stripe like any paid plan choice.
 */
export function restartCheckoutPath(options: { trial_eligible: boolean; plan_code?: CheckoutTarget | null; return_path?: string; source?: CheckoutSource | null }): string {
  const { trial_eligible, return_path, source } = options;
  return trial_eligible
    ? checkoutPath({ with_trial: true, return_path, source })
    : checkoutPath({ plan_code: options.plan_code ?? TRIAL_PLAN, with_trial: false, return_path, source, auto: true });
}

/**
 * The plan and trial a checkout URL asks for. The trial is the trial plan's: an explicit trial=1 on another plan
 * (plan=weekly&trial=1 from before the trial moved to Monthly) is the Monthly trial, never an immediate charge for
 * that plan. Without a trial parameter only the trial plan (or no plan) starts with the trial.
 */
export function checkoutChoice(params: URLSearchParams): { plan: CheckoutTarget; withTrial: boolean } {
  const plan = params.get("plan");
  const requested = isCheckoutTarget(plan) ? plan : TRIAL_PLAN;
  const trial = params.get("trial");
  const withTrial = trial === "1" || (trial !== "0" && requested === TRIAL_PLAN);
  return { plan: withTrial ? TRIAL_PLAN : requested, withTrial };
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

import type { PlanCatalog, PlanCode } from "./entitlements.types";

interface CreatePlanCatalogOptions {
  freeUsageLimitsEnabled?: boolean;
  weeklyStripePriceId?: string | null;
  monthlyStripePriceId?: string | null;
  annualStripePriceId?: string | null;
  proStripePriceId?: string | null;
  lifetimeStripePriceId?: string | null;
}

const FREE_STORAGE_BYTES = 25 * 1024 * 1024;

const UNLIMITED_LIMITS = {
  tailored_cv_generations: null,
  exports: null,
  ai_actions: null,
  storage_bytes: null
} as const;

const UNLIMITED_FEATURES = {
  can_generate_tailored_cv: true,
  can_export_pdf: true,
  can_export_docx: true,
  can_use_ai_actions: true
} as const;

export const createPlanCatalog = (options?: CreatePlanCatalogOptions): PlanCatalog => {
  const paidPlanDefaults = {
    limits: { ...UNLIMITED_LIMITS },
    features: { ...UNLIMITED_FEATURES }
  } as const;

  return {
    free: {
      code: "free",
      name: "Free",
      stripe_price_id: null,
      limits: options?.freeUsageLimitsEnabled === false ? { ...UNLIMITED_LIMITS } : {
        tailored_cv_generations: 3,
        exports: 5,
        ai_actions: 20,
        storage_bytes: FREE_STORAGE_BYTES
      },
      features: {
        can_generate_tailored_cv: true,
        can_export_pdf: true,
        can_export_docx: true,
        can_use_ai_actions: true
      },
      checkout_allowed: false,
      trial_supported: false
    },
    weekly: {
      code: "weekly",
      name: "Weekly",
      stripe_price_id: options?.weeklyStripePriceId ?? null,
      ...paidPlanDefaults,
      checkout_allowed: true,
      // Carried the free trial until 2026-11-05; still sold, charged at checkout. Trials started on it before
      // then still convert to Weekly (their plan comes from the subscription, never from this flag).
      trial_supported: false
    },
    monthly: {
      code: "monthly",
      name: "Monthly",
      stripe_price_id: options?.monthlyStripePriceId ?? null,
      ...paidPlanDefaults,
      checkout_allowed: true,
      // The free trial plan since 2026-11-05: Checkout adds BILLING_TRIAL_PERIOD_DAYS, then Stripe bills the
      // monthly price. The single source of truth for which plan carries the trial (prices, checkout, refresh).
      trial_supported: true
    },
    annual: {
      code: "annual",
      name: "Annual",
      stripe_price_id: options?.annualStripePriceId ?? null,
      ...paidPlanDefaults,
      checkout_allowed: true,
      trial_supported: false
    },
    pro: {
      code: "pro",
      name: "Legacy Pro",
      stripe_price_id: options?.proStripePriceId ?? null,
      ...paidPlanDefaults,
      checkout_allowed: false,
      trial_supported: false,
      legacy: true
    },
    lifetime: {
      code: "lifetime",
      name: "Legacy Lifetime Pro",
      stripe_price_id: options?.lifetimeStripePriceId ?? null,
      ...paidPlanDefaults,
      checkout_allowed: false,
      trial_supported: false,
      legacy: true
    }
  };
};

export const DEFAULT_FREE_PLAN_CODE = "free" as const;

// Every plan that has ever granted the free trial: legacy Pro, Weekly (until 2026-11-05) and Monthly (since then).
// History, not the catalog: a plan keeps its place here after its trial_supported flag is turned off, so its past
// subscriptions still count as a used trial and its running trials still get the trial's cancel offer.
export const TRIAL_CAPABLE_PLAN_CODES: readonly PlanCode[] = ["pro", "weekly", "monthly"];

/** The plans whose checkout grants the free trial now, from the catalog's trial_supported flags. */
export const trialPlanCodes = (catalog: PlanCatalog): PlanCode[] =>
  Object.values(catalog).filter((plan) => plan.checkout_allowed && plan.trial_supported).map((plan) => plan.code);

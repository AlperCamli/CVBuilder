import type { PlanCatalog } from "./entitlements.types";

interface CreatePlanCatalogOptions {
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
      limits: {
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
      trial_supported: true
    },
    monthly: {
      code: "monthly",
      name: "Monthly",
      stripe_price_id: options?.monthlyStripePriceId ?? null,
      ...paidPlanDefaults,
      checkout_allowed: true,
      trial_supported: false
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

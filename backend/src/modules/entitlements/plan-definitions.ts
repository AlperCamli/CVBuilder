import type { PlanCatalog } from "./entitlements.types";

interface CreatePlanCatalogOptions {
  proStripePriceId?: string | null;
}

const FREE_STORAGE_BYTES = 25 * 1024 * 1024;

export const createPlanCatalog = (options?: CreatePlanCatalogOptions): PlanCatalog => {
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
      }
    },
    pro: {
      code: "pro",
      name: "Pro",
      stripe_price_id: options?.proStripePriceId ?? null,
      limits: {
        tailored_cv_generations: null,
        exports: null,
        ai_actions: null,
        storage_bytes: null
      },
      features: {
        can_generate_tailored_cv: true,
        can_export_pdf: true,
        can_export_docx: true,
        can_use_ai_actions: true
      }
    }
  };
};

export const DEFAULT_FREE_PLAN_CODE = "free" as const;
export const DEFAULT_PRO_PLAN_CODE = "pro" as const;

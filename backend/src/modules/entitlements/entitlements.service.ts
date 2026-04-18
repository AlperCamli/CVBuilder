import type { UsageCounterRecord } from "../../shared/types/domain";
import {
  DEFAULT_FREE_PLAN_CODE,
  DEFAULT_PRO_PLAN_CODE
} from "./plan-definitions";
import type {
  EntitlementDecision,
  GatedAction,
  PlanCatalog,
  PlanCode,
  PlanDefinition,
  ResolvedEntitlements,
  SubscriptionLike,
  UsageLimits,
  UsageRemaining,
  UsageResolution
} from "./entitlements.types";

const ACTIVE_PAID_STATUSES = new Set(["active", "trialing"]);

const resolveRemainingValue = (limit: number | null, consumed: number): number | null => {
  if (limit === null) {
    return null;
  }

  return Math.max(limit - consumed, 0);
};

export class EntitlementsService {
  constructor(private readonly planCatalog: PlanCatalog) {}

  getPlanCatalog(): PlanCatalog {
    return this.planCatalog;
  }

  getPlanDefinition(planCode: string | null | undefined): PlanDefinition {
    if (!planCode) {
      return this.planCatalog[DEFAULT_FREE_PLAN_CODE];
    }

    const normalized = planCode.toLowerCase();
    if (normalized === DEFAULT_PRO_PLAN_CODE) {
      return this.planCatalog.pro;
    }

    return this.planCatalog.free;
  }

  resolveEffectivePlanCode(subscription: SubscriptionLike | null): PlanCode {
    if (!subscription) {
      return DEFAULT_FREE_PLAN_CODE;
    }

    if (!ACTIVE_PAID_STATUSES.has(subscription.status)) {
      return DEFAULT_FREE_PLAN_CODE;
    }

    return this.getPlanDefinition(subscription.plan_code).code;
  }

  resolveUsage(usage: UsageCounterRecord, planCode: PlanCode): UsageResolution {
    const limits = this.getPlanDefinition(planCode).limits;

    return {
      plan_code: planCode,
      period_month: usage.period_month,
      tailored_cv_generations_count: usage.tailored_cv_generations_count,
      exports_count: usage.exports_count,
      ai_actions_count: usage.ai_actions_count,
      storage_bytes_used: usage.storage_bytes_used,
      limits,
      remaining: this.resolveRemaining(usage, limits)
    };
  }

  resolveEntitlements(usage: UsageCounterRecord, planCode: PlanCode): ResolvedEntitlements {
    const definition = this.getPlanDefinition(planCode);
    const remaining = this.resolveRemaining(usage, definition.limits);

    return {
      plan_code: planCode,
      can_generate_tailored_cv:
        definition.features.can_generate_tailored_cv && remaining.tailored_cv_generations !== 0,
      can_export_pdf: definition.features.can_export_pdf && remaining.exports !== 0,
      can_export_docx: definition.features.can_export_docx && remaining.exports !== 0,
      can_use_ai_actions: definition.features.can_use_ai_actions && remaining.ai_actions !== 0,
      limits: definition.limits,
      remaining
    };
  }

  evaluateAction(action: GatedAction, entitlements: ResolvedEntitlements): EntitlementDecision {
    switch (action) {
      case "tailored_cv_generation": {
        return {
          action,
          allowed: entitlements.can_generate_tailored_cv,
          reason: entitlements.can_generate_tailored_cv
            ? null
            : "Monthly tailored CV generation limit has been reached"
        };
      }
      case "export_pdf": {
        return {
          action,
          allowed: entitlements.can_export_pdf,
          reason: entitlements.can_export_pdf ? null : "Monthly export limit has been reached"
        };
      }
      case "export_docx": {
        return {
          action,
          allowed: entitlements.can_export_docx,
          reason: entitlements.can_export_docx ? null : "Monthly export limit has been reached"
        };
      }
      case "ai_action": {
        return {
          action,
          allowed: entitlements.can_use_ai_actions,
          reason: entitlements.can_use_ai_actions ? null : "Monthly AI action limit has been reached"
        };
      }
      default: {
        return {
          action,
          allowed: false,
          reason: "Entitlement action is not supported"
        };
      }
    }
  }

  private resolveRemaining(usage: UsageCounterRecord, limits: UsageLimits): UsageRemaining {
    return {
      tailored_cv_generations: resolveRemainingValue(
        limits.tailored_cv_generations,
        usage.tailored_cv_generations_count
      ),
      exports: resolveRemainingValue(limits.exports, usage.exports_count),
      ai_actions: resolveRemainingValue(limits.ai_actions, usage.ai_actions_count),
      storage_bytes: resolveRemainingValue(limits.storage_bytes, usage.storage_bytes_used)
    };
  }
}

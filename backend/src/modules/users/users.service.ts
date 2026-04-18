import { NotFoundError } from "../../shared/errors/app-error";
import type {
  CurrentPlanSummary,
  SubscriptionRecord,
  UsageCounterRecord,
  UsageSummary,
  UserRecord
} from "../../shared/types/domain";
import type { SubscriptionsRepository } from "./subscriptions.repository";
import type { UsageRepository } from "./usage.repository";
import type {
  MeResponseData,
  SessionContext,
  SettingsResponseData,
  UpdateMeInput,
  UpdateSettingsInput,
  UsageResponseData
} from "./users.types";
import type { UsersRepository } from "./users.repository";

export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly usageRepository: UsageRepository
  ) {}

  async getMe(session: SessionContext): Promise<MeResponseData> {
    const user = await this.requireUser(session.appUser.id);
    const currentPlan = await this.resolveCurrentPlan(user.id);
    const usageSummary = await this.resolveUsageSummary(user.id, currentPlan.plan_code);

    return {
      user,
      current_plan: currentPlan,
      usage_summary: usageSummary
    };
  }

  async updateMe(session: SessionContext, input: UpdateMeInput): Promise<{ user: UserRecord }> {
    const updatedUser = await this.usersRepository.updateProfile(session.appUser.id, input);

    return {
      user: updatedUser
    };
  }

  async getSettings(session: SessionContext): Promise<{ settings: SettingsResponseData }> {
    const user = await this.requireUser(session.appUser.id);

    return {
      settings: {
        locale: user.locale,
        default_cv_language: user.default_cv_language,
        onboarding_completed: user.onboarding_completed
      }
    };
  }

  async updateSettings(
    session: SessionContext,
    input: UpdateSettingsInput
  ): Promise<{ settings: SettingsResponseData }> {
    const updatedUser = await this.usersRepository.updateSettings(session.appUser.id, input);

    return {
      settings: {
        locale: updatedUser.locale,
        default_cv_language: updatedUser.default_cv_language,
        onboarding_completed: updatedUser.onboarding_completed
      }
    };
  }

  async getUsage(session: SessionContext): Promise<UsageResponseData> {
    const currentPlan = await this.resolveCurrentPlan(session.appUser.id);

    return this.resolveUsageSummary(session.appUser.id, currentPlan.plan_code);
  }

  private async requireUser(userId: string): Promise<UserRecord> {
    const user = await this.usersRepository.getById(userId);

    if (!user) {
      throw new NotFoundError("Authenticated user was not found");
    }

    return user;
  }

  private async resolveCurrentPlan(userId: string): Promise<CurrentPlanSummary> {
    const subscription = await this.subscriptionsRepository.getCurrentForUser(userId);

    return this.toCurrentPlanSummary(subscription);
  }

  private async resolveUsageSummary(userId: string, planCode: string): Promise<UsageSummary> {
    const usage = await this.usageRepository.getOrCreateCurrentMonth(userId);

    return this.toUsageSummary(usage, planCode);
  }

  private toCurrentPlanSummary(subscription: SubscriptionRecord | null): CurrentPlanSummary {
    if (!subscription) {
      return {
        plan_code: "free",
        status: "inactive",
        current_period_start: null,
        current_period_end: null,
        cancel_at_period_end: false
      };
    }

    return {
      plan_code: subscription.plan_code,
      status: subscription.status,
      current_period_start: subscription.current_period_start,
      current_period_end: subscription.current_period_end,
      cancel_at_period_end: subscription.cancel_at_period_end
    };
  }

  private toUsageSummary(usage: UsageCounterRecord, planCode: string): UsageSummary {
    return {
      period_month: usage.period_month,
      tailored_cv_generations_count: usage.tailored_cv_generations_count,
      exports_count: usage.exports_count,
      ai_actions_count: usage.ai_actions_count,
      storage_bytes_used: usage.storage_bytes_used,
      plan_code: planCode,
      limits: {
        tailored_cv_generations: null,
        exports: null,
        ai_actions: null,
        storage_bytes: null
      }
    };
  }
}

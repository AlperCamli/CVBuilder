import { NotFoundError } from "../../shared/errors/app-error";
import type { OnboardingState, UserRecord } from "../../shared/types/domain";
import type { BillingService } from "../billing/billing.service";
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
    private readonly billingService: BillingService
  ) {}

  async getMe(session: SessionContext): Promise<MeResponseData> {
    const user = await this.requireUser(session.appUser.id);
    const [currentPlan, usageSummary, entitlements] = await Promise.all([
      this.billingService.getCurrentPlanSummary(user.id),
      this.billingService.getUsageSummary(user.id),
      this.billingService.getResolvedEntitlements(user.id)
    ]);

    return {
      user,
      current_plan: currentPlan,
      usage_summary: usageSummary,
      entitlements
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
        onboarding_completed: user.onboarding_completed,
        onboarding_state: user.onboarding_state ?? {}
      }
    };
  }

  async updateSettings(
    session: SessionContext,
    input: UpdateSettingsInput
  ): Promise<{ settings: SettingsResponseData }> {
    let payload = input;

    if (input.onboarding_state) {
      const user = await this.requireUser(session.appUser.id);
      payload = {
        ...input,
        onboarding_state: mergeOnboardingState(user.onboarding_state ?? {}, input.onboarding_state)
      };
    }

    const updatedUser = await this.usersRepository.updateSettings(session.appUser.id, payload);

    return {
      settings: {
        locale: updatedUser.locale,
        default_cv_language: updatedUser.default_cv_language,
        onboarding_completed: updatedUser.onboarding_completed,
        onboarding_state: updatedUser.onboarding_state ?? {}
      }
    };
  }

  async getUsage(session: SessionContext): Promise<UsageResponseData> {
    return this.billingService.getUsageSummary(session.appUser.id);
  }

  private async requireUser(userId: string): Promise<UserRecord> {
    const user = await this.usersRepository.getById(userId);

    if (!user) {
      throw new NotFoundError("Authenticated user was not found");
    }

    return user;
  }
}

// Onboarding progress never regresses: existing step timestamps and
// skipped_at/completed_at markers win over incoming values, so concurrent
// tabs can only add steps, not clear them.
function mergeOnboardingState(existing: OnboardingState, incoming: OnboardingState): OnboardingState {
  return {
    steps: { ...incoming.steps, ...existing.steps },
    skipped_at: existing.skipped_at ?? incoming.skipped_at,
    completed_at: existing.completed_at ?? incoming.completed_at
  };
}

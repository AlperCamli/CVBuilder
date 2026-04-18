import { NotFoundError } from "../../shared/errors/app-error";
import type { UserRecord } from "../../shared/types/domain";
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

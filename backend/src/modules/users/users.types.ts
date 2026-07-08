import type {
  CurrentPlanSummary,
  EntitlementSummary,
  OnboardingState,
  UsageSummary,
  UserRecord
} from "../../shared/types/domain";
import type { AuthenticatedRequestContext } from "../auth/auth.types";

export interface UpdateMeInput {
  full_name?: string;
  default_cv_language?: string;
}

export interface UpdateSettingsInput {
  locale?: "en" | "tr";
  default_cv_language?: string;
  onboarding_completed?: boolean;
  onboarding_state?: OnboardingState;
}

export interface MeResponseData {
  user: UserRecord;
  current_plan: CurrentPlanSummary;
  usage_summary: UsageSummary;
  entitlements: EntitlementSummary;
}

export interface SettingsResponseData {
  locale: "en" | "tr";
  default_cv_language: string | null;
  onboarding_completed: boolean;
  onboarding_state: OnboardingState;
}

export interface UsageResponseData extends UsageSummary {}

export type SessionContext = AuthenticatedRequestContext;

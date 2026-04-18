import type { UsersService } from "../users/users.service";
import type { SessionContext } from "../users/users.types";
import type { DashboardRepository } from "./dashboard.repository";
import type { DashboardActivityResponseData, DashboardResponseData } from "./dashboard.types";

export class DashboardService {
  constructor(
    private readonly usersService: UsersService,
    private readonly dashboardRepository: DashboardRepository
  ) {}

  async getDashboard(session: SessionContext): Promise<DashboardResponseData> {
    const meData = await this.usersService.getMe(session);
    const summary = await this.dashboardRepository.getSummarySnapshot(session.appUser.id);
    const recentActivity = await this.dashboardRepository.getRecentActivity(session.appUser.id, 8);

    return {
      user_summary: {
        id: meData.user.id,
        email: meData.user.email,
        full_name: meData.user.full_name
      },
      current_plan: meData.current_plan,
      usage_summary: meData.usage_summary,
      master_cv_summary: {
        total_count: summary.master_total_count,
        primary_master_cv: summary.primary_master_cv
      },
      tailored_cv_summary: {
        total_count: summary.tailored_total_count,
        recent_items: summary.recent_tailored_cvs
      },
      jobs_summary: {
        total_count: summary.jobs_total_count,
        counts_by_status: summary.jobs_counts_by_status,
        recent_items: summary.recent_jobs
      },
      recent_activity: recentActivity,
      locale: meData.user.locale,
      onboarding_completed: meData.user.onboarding_completed
    };
  }

  async getActivity(session: SessionContext): Promise<DashboardActivityResponseData> {
    const activity = await this.dashboardRepository.getRecentActivity(session.appUser.id, 30);

    return {
      activity
    };
  }
}

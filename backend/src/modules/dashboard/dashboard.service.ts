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
    const counts = await this.dashboardRepository.getPlaceholderCounts(session.appUser.id);

    return {
      user_summary: {
        id: meData.user.id,
        email: meData.user.email,
        full_name: meData.user.full_name
      },
      current_plan: meData.current_plan,
      usage_summary: meData.usage_summary,
      counts,
      locale: meData.user.locale,
      onboarding_completed: meData.user.onboarding_completed
    };
  }

  async getActivity(session: SessionContext): Promise<DashboardActivityResponseData> {
    const activity = await this.dashboardRepository.getRecentActivity(session.appUser.id);

    return {
      activity
    };
  }
}

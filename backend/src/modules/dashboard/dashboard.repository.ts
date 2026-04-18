import type { DashboardActivityItem, DashboardCounts } from "./dashboard.types";

export interface DashboardRepository {
  getPlaceholderCounts(userId: string): Promise<DashboardCounts>;
  getRecentActivity(userId: string): Promise<DashboardActivityItem[]>;
}

export class PlaceholderDashboardRepository implements DashboardRepository {
  async getPlaceholderCounts(_userId: string): Promise<DashboardCounts> {
    return {
      master_cvs: 0,
      tailored_cvs: 0,
      jobs: 0,
      exports: 0
    };
  }

  async getRecentActivity(_userId: string): Promise<DashboardActivityItem[]> {
    return [];
  }
}

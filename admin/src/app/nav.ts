import {
  Activity,
  Bell,
  Bot,
  CreditCard,
  HeartPulse,
  LayoutDashboard,
  Megaphone,
  Sparkles,
  Users,
  type LucideIcon,
} from "lucide-react";
import { useLocation } from "react-router";
import { OVERVIEW_METRICS } from "@/pages/Overview";
import { ACQUISITION, AI_COST, ENGAGEMENT, metricsOf, MONETIZATION, TAILORING, type PageSection } from "./pages";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Metrics rendered on the page, used to tell which URL filters actually apply there. */
  metrics: string[];
  /** The page has a real screen (others show a placeholder until their phase ships). */
  ready?: boolean;
  /** A generic metrics page built from these sections (see ./pages.ts). */
  sections?: PageSection[];
  /**
   * The page shows personal data from the people endpoints: global date/segment filters don't apply there, and
   * the "every lookup is logged" note replaces the filter bar.
   */
  people?: boolean;
  /** Shown instead of the filter bar on pages the global filters don't apply to (Alerts, Data health). */
  note?: string;
}

function sectionPage(path: string, label: string, icon: LucideIcon, sections: PageSection[]): NavItem {
  return { path, label, icon, metrics: metricsOf(sections), sections, ready: true };
}

export const NAV: NavItem[] = [
  { path: "/", label: "Overview", icon: LayoutDashboard, metrics: OVERVIEW_METRICS, ready: true },
  sectionPage("/monetization", "Monetization", CreditCard, MONETIZATION),
  sectionPage("/ai-cost", "AI cost", Bot, AI_COST),
  sectionPage("/engagement", "Engagement", Activity, ENGAGEMENT),
  sectionPage("/tailoring", "Tailoring", Sparkles, TAILORING),
  sectionPage("/acquisition", "Acquisition", Megaphone, ACQUISITION),
  { path: "/users", label: "Users", icon: Users, metrics: [], ready: true, people: true },
  {
    path: "/alerts",
    label: "Alerts",
    icon: Bell,
    metrics: [],
    ready: true,
    note: "Page filters don't apply here; each rule has its own. Rules are checked hourly; all times UTC.",
  },
  {
    path: "/data-health",
    label: "Data health",
    icon: HeartPulse,
    metrics: [],
    ready: true,
    note: "Page filters don't apply here; internal accounts are excluded. All times UTC.",
  },
];

/** The nav entry for a path; sub-pages (e.g. /users/:id) belong to their section. */
export const pageFor = (pathname: string) =>
  NAV.find((n) => n.path === pathname) ?? NAV.find((n) => n.path !== "/" && pathname.startsWith(`${n.path}/`));

export function useCurrentPage() {
  const { pathname } = useLocation();
  return pageFor(pathname);
}

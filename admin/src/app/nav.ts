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

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Metrics rendered on the page, used to tell which URL filters actually apply there. */
  metrics: string[];
}

export const NAV: NavItem[] = [
  { path: "/", label: "Overview", icon: LayoutDashboard, metrics: OVERVIEW_METRICS },
  { path: "/monetization", label: "Monetization", icon: CreditCard, metrics: [] },
  { path: "/ai-cost", label: "AI cost", icon: Bot, metrics: [] },
  { path: "/engagement", label: "Engagement", icon: Activity, metrics: [] },
  { path: "/tailoring", label: "Tailoring", icon: Sparkles, metrics: [] },
  { path: "/acquisition", label: "Acquisition", icon: Megaphone, metrics: [] },
  { path: "/users", label: "Users", icon: Users, metrics: [] },
  { path: "/alerts", label: "Alerts", icon: Bell, metrics: [] },
  { path: "/data-health", label: "Data health", icon: HeartPulse, metrics: [] },
];

export function useCurrentPage() {
  const { pathname } = useLocation();
  return NAV.find((n) => n.path === pathname);
}

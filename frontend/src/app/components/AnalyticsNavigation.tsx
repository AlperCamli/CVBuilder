import { useEffect } from "react";
import { useLocation } from "react-router";
import { trackPageView } from "../integration/analytics";

export function AnalyticsNavigation() {
  const {pathname} = useLocation();
  useEffect(() => { trackPageView(pathname); }, [pathname]);
  return null;
}

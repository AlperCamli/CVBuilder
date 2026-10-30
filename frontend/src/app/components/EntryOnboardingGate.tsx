import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "../integration/auth-context";
import { entryOnboardingRedirect } from "../integration/entry-onboarding";

// Sends accounts that skipped the landing onboarding back to it. Mounted after
// PostAuthRedirectResumer and waits one commit, so a stashed destination (e.g. the
// purchase flow's checkout after email verification) is applied before deciding.
export function EntryOnboardingGate({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const { pathname } = useLocation();
  const [settled, setSettled] = useState(false);
  useEffect(() => setSettled(true), []);
  if (!settled) return null;
  const target = entryOnboardingRedirect(pathname, me);
  return target ? <Navigate to={target} replace /> : <>{children}</>;
}

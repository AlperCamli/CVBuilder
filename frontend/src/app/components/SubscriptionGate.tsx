import { useUpgradePrompt } from "../contexts/UpgradePromptContext";
import { useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "../integration/auth-context";
import { checkoutPath, hasAppAccess, canOpenExistingCvWorkspace } from "../integration/subscription-flow";
import { translate as t } from "../localization/i18n";

export function SubscriptionGate({ children }: { children: ReactNode }) {
  const { api } = useAuth();
  const { showUpgradePrompt } = useUpgradePrompt();
  const { pathname, search } = useLocation();
  const exempt = /^\/app\/(onboarding(?:\/|$)|cv-score(?:\/|$)|checkout(?:\/|$)|pricing(?:\/|$)|profile(?:\/|$))/.test(pathname);
  const [state, setState] = useState<{ path: string; access?: boolean; fullAccess?: boolean; trialEligible?: boolean; manualReturn?: string; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (exempt) return;
    let active = true;
    void api.getBillingPlan().then(plan => {
      if (!active) return;
      const fullAccess = hasAppAccess(plan);
      const access = fullAccess || Boolean(plan.can_edit_existing_cvs && canOpenExistingCvWorkspace(pathname));
      let manualReturn: string | undefined;
      if (!access && plan.can_edit_existing_cvs) {
        const sourceCv = /^\/app\/tailor\/([\da-f-]{36})\/?$/i.exec(pathname)?.[1];
        manualReturn = sourceCv ? `/app/cv/${sourceCv}` : "/app/resumes";
        showUpgradePrompt("limit_reached", {
          requiresPro: true,
          feature: pathname.includes("tailor") ? "tailored_cv_generation" : pathname.includes("ai-") ? "ai_action" : undefined,
          returnPath: `${pathname}${search}`
        });
      }
      setState({ path: pathname, trialEligible: plan.trial_eligible, access, fullAccess, manualReturn });
    })
      .catch(error => { if (active) setState({ path: pathname, error: error instanceof Error ? error.message : t("Could not verify your subscription.") }); });
    return () => { active = false; };
  }, [api, pathname, search, exempt, retry, showUpgradePrompt]);
  useEffect(() => {
    if (exempt) return;
    const recheck = () => setRetry(value => value + 1);
    window.addEventListener("focus", recheck);
    const timer = window.setInterval(recheck, 60000);
    return () => { window.removeEventListener("focus", recheck); window.clearInterval(timer); };
  }, [exempt]);
  if (exempt) return <>{children}</>;
  // Keep access checks in place without flashing subscription status during navigation.
  // With full app access (not path-dependent) the current page stays mounted while the new
  // path is re-verified, so in-app navigation (e.g. the editor switching to a new tailored
  // copy) does not remount the app shell.
  if (!state || (state.path !== pathname && !(state.fullAccess && !state.error))) return null;
  if (state.error) return <div className="p-8"><p role="alert">{t(state.error)}</p><button onClick={() => setRetry(value => value + 1)}>{t("Try again")}</button></div>;
  if (state.manualReturn) return <Navigate to={state.manualReturn} replace />;
  if (!state.access) return <Navigate to={checkoutPath({ with_trial: state.trialEligible !== false, return_path: `${pathname}${search}` })} replace />;
  return <>{children}</>;
}

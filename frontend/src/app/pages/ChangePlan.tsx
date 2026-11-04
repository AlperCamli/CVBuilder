import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarCheck, Loader2, ShieldCheck } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { CheckoutLoading, CheckoutShell, ProBenefits } from "../components/CheckoutScreen";
import { SupportHelp } from "../components/SupportHelp";
import { ApiClientError } from "../integration/api-error";
import type { BillingPlanResponseData } from "../integration/api-types";
import { useAuth } from "../integration/auth-context";
import { planName, planPeriod } from "../integration/cancel-offer";
import { planDate } from "../integration/checkout-screen";
import { formatMoney, useRegionalPricing } from "../integration/regional-pricing";
import { localeCode, translate as t } from "../localization/i18n";
import "../components/cancel-offer.css";

type PlanCode = "weekly" | "monthly" | "annual";
const RANK: Record<PlanCode, number> = { weekly: 1, monthly: 2, annual: 3 };
const isPlan = (value: string | null | undefined): value is PlanCode => value === "weekly" || value === "monthly" || value === "annual";

const SCHEDULE_FAILED = "We couldn’t schedule the switch. Nothing has changed. Please try again.";
const KEEP_FAILED = "We couldn’t keep your current plan. Please try again.";

function Footer() {
  return <footer className="checkout-screen-footer">
    <Link to="/app/pricing"><ArrowLeft size={13} aria-hidden="true" />{t("Back to plans")}</Link>
    <SupportHelp topic="Payment" />
  </footer>;
}

/**
 * Plan changes from Pricing for a paying account. A downgrade (to a shorter plan) waits for the end of the paid
 * period: nothing is refunded, the current plan runs to its end, then the new one starts and is billed. An upgrade
 * goes to Stripe's confirmation, which shows the amount due today. A change that is already waiting can be dropped.
 */
export function ChangePlan() {
  const { api, refreshMe } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const target = params.get("plan");
  const regional = useRegionalPricing();
  const [plan, setPlan] = useState<BillingPlanResponseData | null>(null);
  const [done, setDone] = useState<"scheduled" | "kept" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const openUpgrade = useCallback(async (planCode: PlanCode) => {
    try {
      const response = await api.createBillingPortal({ return_url: `${window.location.origin}/app/profile`, flow: "change_plan", plan_code: planCode });
      window.location.href = response.portal_url;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to open billing portal."));
    }
  }, [api]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      let billing: BillingPlanResponseData;
      try { billing = await api.getBillingPlan(); } catch { navigate("/app/pricing", { replace: true }); return; }
      const current = billing.plan_code;
      if (!isPlan(target) || !isPlan(current) || !["active", "trialing"].includes(billing.subscription_status) || (target === current && !billing.scheduled_change)) {
        navigate("/app/pricing", { replace: true });
        return;
      }
      // Upgrades (and any change during a trial) are confirmed at Stripe with the amount due.
      if (!billing.scheduled_change && (billing.subscription_status === "trialing" || RANK[target] > RANK[current])) {
        setPlan(billing);
        await openUpgrade(target);
        return;
      }
      setPlan(billing);
    })();
  }, [api, navigate, openUpgrade, target]);

  if (!plan || !isPlan(target) || !isPlan(plan.plan_code)) return <CheckoutLoading />;
  const current = plan.plan_code;
  const date = planDate(plan.scheduled_change?.starts_at ?? plan.current_period_end, localeCode()) ?? "";
  const currentName = t(planName(current));
  const amount = regional.prices?.plans.find(item => item.code === target)?.amount;
  const price = amount !== undefined && regional.prices ? formatMoney(amount, regional.prices.currency) : "—";
  const run = async (action: () => Promise<BillingPlanResponseData>, next: "scheduled" | "kept", failure: string) => {
    setBusy(true);
    setError(null);
    try {
      setPlan(await action());
      setDone(next);
      void refreshMe();
    } catch (err) {
      setError(err instanceof ApiClientError && err.status === 409 ? err.message : failure);
    } finally {
      setBusy(false);
    }
  };
  const keep = () => void run(() => api.keepCurrentPlan(), "kept", KEEP_FAILED);

  if (done) {
    const scheduled = done === "scheduled" && plan.scheduled_change;
    return <CheckoutShell mascot="celebrate" eyebrow={t(scheduled ? "SWITCH SCHEDULED" : "PLAN KEPT")}
      title={scheduled ? t("Your switch to {{plan}} is scheduled.", { plan: t(planName(plan.scheduled_change!.plan_code)) }) : t("You’re staying on {{plan}}.", { plan: currentName })}
      lead={scheduled
        ? t("You keep Pro {{current}} until {{date}}. Then Pro {{plan}} starts at {{price}}.", { current: currentName, date, plan: t(planName(plan.scheduled_change!.plan_code)), price })
        : t("Nothing changes: your {{plan}} plan renews as usual.", { plan: currentName })}
      footer={<Footer />}>
      <ProBenefits />
      <button className="checkout-screen-primary" type="button" onClick={() => navigate("/app/profile")}>{t("Back to Profile")}<ArrowRight size={16} aria-hidden="true" /></button>
    </CheckoutShell>;
  }

  // A change is already waiting: show it, with the way to keep the current plan.
  if (plan.scheduled_change) {
    const waiting = t(planName(plan.scheduled_change.plan_code));
    return <CheckoutShell mascot="point" eyebrow={t("PLAN CHANGE")} title={t("You’re switching to {{plan}} on {{date}}.", { plan: waiting, date })}
      lead={t("Until then you keep Pro {{current}}. To choose another plan, keep {{current}} first.", { current: currentName })} footer={<Footer />}>
      {error && <p role="alert" className="checkout-screen-error">{t(error)}</p>}
      <button className="checkout-screen-primary" type="button" disabled={busy} onClick={keep}>
        {busy ? <><Loader2 className="animate-spin" size={16} aria-hidden="true" />{t("Saving...")}</> : <>{t("Keep {{plan}} instead", { plan: currentName })}<ArrowRight size={16} aria-hidden="true" /></>}
      </button>
      <Link className="checkout-screen-secondary" to="/app/pricing">{t("Back to plans")}</Link>
    </CheckoutShell>;
  }

  if (plan.subscription_status === "trialing" || RANK[target] > RANK[current]) {
    return <CheckoutShell mascot="point" title={error ? t("We couldn’t open the plan change") : t("Just a moment…")}
      lead={error ? t("Your plan hasn’t changed. Please try again.") : t("Opening secure checkout…")} footer={<Footer />}>
      {error
        ? <><p role="alert" className="checkout-screen-error">{t(error)}</p>
          <button className="checkout-screen-primary" type="button" onClick={() => { setError(null); void openUpgrade(target); }}>{t("Try again")}<ArrowRight size={16} aria-hidden="true" /></button></>
        : <p role="status" className="checkout-screen-waiting"><Loader2 className="animate-spin" size={16} aria-hidden="true" />{t("Loading…")}</p>}
    </CheckoutShell>;
  }

  const targetName = t(planName(target));
  return <CheckoutShell mascot="point" eyebrow={t("PLAN CHANGE")} title={t("Switch to {{plan}} when your current plan ends", { plan: targetName })}
    lead={t("Your {{current}} plan stays active until {{date}}. The remaining time isn’t refunded; Pro {{plan}} starts then.", { current: currentName, date, plan: targetName })}
    footer={<Footer />}>
    <div className="checkout-screen-offer">
      <div>
        <strong>{t("Pro {{plan}}", { plan: targetName })}</strong>
        <p>{t("Unlimited CVs, exports and AI tools.")}</p>
      </div>
      <div className="checkout-screen-price">
        <strong>{price}</strong>
        <span>{t("every {{period}}", { period: t(planPeriod(target)) })}</span>
      </div>
    </div>
    <ol className="checkout-screen-timeline cancel-offer-timeline" aria-label={t("What happens when you switch")}>
      <li>
        <span><ShieldCheck size={14} aria-hidden="true" /></span>
        <div><strong>{t("Until {{date}}: Pro {{plan}}", { date, plan: currentName })}</strong><p>{t("Already paid. Nothing changes and nothing is charged.")}</p></div>
      </li>
      <li>
        <span><CalendarCheck size={14} aria-hidden="true" /></span>
        <div><strong>{t("{{date}}: {{price}}", { date, price })}</strong><p>{t("Pro {{plan}} starts, then renews every {{period}} until you cancel.", { plan: targetName, period: t(planPeriod(target)) })}</p></div>
      </li>
    </ol>
    {error && <p role="alert" className="checkout-screen-error">{t(error)}</p>}
    <button className="checkout-screen-primary" type="button" disabled={busy} onClick={() => void run(() => api.schedulePlanChange(target), "scheduled", SCHEDULE_FAILED)}>
      {busy ? <><Loader2 className="animate-spin" size={16} aria-hidden="true" />{t("Saving...")}</> : <>{t("Switch on {{date}}", { date })}<ArrowRight size={16} aria-hidden="true" /></>}
    </button>
    <Link className="checkout-screen-secondary" to="/app/pricing">{t("Keep {{plan}}", { plan: currentName })}</Link>
    <p className="checkout-screen-terms">{t("No refund or credit is given for the rest of your {{current}} plan. You can keep {{current}} instead until {{date}}.", { current: currentName, date })}</p>
  </CheckoutShell>;
}

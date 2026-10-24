import { ArrowLeft, ArrowRight, Check, CreditCard, Loader2, LockKeyhole, PauseCircle, Sparkles } from "lucide-react";
import { Link } from "react-router";
import type { CheckoutTarget } from "../../content/pricing";
import { formatMoney, type useRegionalPricing } from "../integration/regional-pricing";
import { checkoutPath } from "../integration/subscription-flow";
import { translate as t } from "../localization/i18n";
import { PricingAvailability } from "./PricingAvailability";
import { SupportHelp } from "./SupportHelp";
import "./checkout-cancelled.css";

interface CheckoutCancelledProps {
  plan: CheckoutTarget;
  trial: boolean;
  eligibility: boolean | null;
  destination: string;
  regional: ReturnType<typeof useRegionalPricing>;
  busy: boolean;
  error: string | null;
  onRetry: () => void;
}

export function CheckoutCancelled({ plan, trial, eligibility, destination, regional, busy, error, onRetry }: CheckoutCancelledProps) {
  const showTrial = eligibility === true;
  const weekly = regional.prices?.plans.find(item => item.code === "weekly");
  const selected = regional.prices?.plans.find(item => item.code === plan);
  const retryLabel = t(plan === "monthly" ? "Try monthly checkout again" : plan === "annual" ? "Try annual checkout again" : "Try weekly checkout again");
  const disabled = busy || !regional.ready || eligibility === null;
  const trialPath = checkoutPath({ with_trial: true, return_path: destination });

  return <section className="checkout-cancelled" aria-labelledby="checkout-cancelled-title">
    <p className="checkout-cancelled-status"><PauseCircle size={15} aria-hidden="true" />{t("Checkout wasn’t completed. You can still pick up here.")}</p>
    <article className="checkout-cancelled-card">
      <header className="checkout-cancelled-head">
        <div className="checkout-cancelled-copy">
          <span className="checkout-cancelled-eyebrow"><Sparkles size={12} aria-hidden="true" />{t(showTrial ? "GIVE PRO A TRY" : "YOUR NEXT STEP")}</span>
          <h1 id="checkout-cancelled-title">{t(showTrial ? "Why don’t you try the free trial first?" : "Let’s pick up where you left off.")}</h1>
          <p>{t(showTrial ? "A little time to see what Pro can do. All the features. Three days to explore." : "Your next step is saved. You can retry your purchase or explore the Pro plans.")}</p>
        </div>
        <img className="checkout-cancelled-mascot" src="/images/designs/mascot/guide.webp" width="177" height="266" alt="" />
      </header>
      <div className="checkout-cancelled-body">
        <PricingAvailability {...regional} />
        <div className="checkout-cancelled-offer">
          <div><strong>{t(showTrial ? "3 days of Pro, on us" : "Pro {{plan}}", { plan: t(plan === "annual" ? "Yearly" : plan === "monthly" ? "Monthly" : "Weekly") })}</strong><p>{t(showTrial ? "Full access from the moment you activate." : "Unlimited CVs, exports and AI tools.")}</p></div>
          <div className="checkout-cancelled-price"><strong>{regional.prices && (showTrial || selected) ? formatMoney(showTrial ? 0 : selected!.amount, regional.prices.currency) : "—"}</strong><span>{t(showTrial ? "today" : plan === "annual" ? "billed yearly" : plan === "monthly" ? "billed monthly" : "billed weekly")}</span></div>
        </div>
        <ul className="checkout-cancelled-features">
          {["Tailor your CV to every opportunity", "Unlimited PDF & DOCX exports", "AI improvements whenever you need them"].map(feature => <li key={feature}><span><Check size={13} aria-hidden="true" /></span>{t(feature)}</li>)}
        </ul>
        <p className="checkout-cancelled-terms">{showTrial && weekly && regional.prices
          ? t("Card required. After 3 days, {{amount}} is billed weekly unless you cancel before the trial ends. Cancel anytime in billing settings.", { amount: formatMoney(weekly.amount, regional.prices.currency) })
          : showTrial ? t("Credit card required. Renewal terms will be shown before you activate your trial.")
          : t("Your subscription renews automatically. You can manage or cancel it in billing settings.")}</p>
        {trial && eligibility === false && <p role="status" className="checkout-cancelled-terms">{t("This account is not eligible for another free trial. Choose a Pro plan to continue.")}</p>}
        {error && <p role="alert" className="checkout-cancelled-error">{t(error)}</p>}
        {showTrial && !trial ? <Link className="checkout-cancelled-primary" to={trialPath} aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}>{t("Start my 3-day free trial")}<ArrowRight size={16} aria-hidden="true" /></Link>
          : trial && !showTrial && eligibility === false ? <Link className="checkout-cancelled-primary" to="/app/pricing">{t("See Pro plans")}<ArrowRight size={16} aria-hidden="true" /></Link>
          : <button className="checkout-cancelled-primary" type="button" disabled={disabled} onClick={onRetry}>{busy ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : null}{busy ? t("Opening secure checkout…") : trial ? t("Start my 3-day free trial") : retryLabel}<ArrowRight size={16} aria-hidden="true" /></button>}
        {showTrial && !trial ? <button className="checkout-cancelled-secondary" type="button" disabled={disabled} onClick={onRetry}>{busy ? <Loader2 className="animate-spin" size={16} aria-hidden="true" /> : null}{busy ? t("Opening secure checkout…") : retryLabel}</button>
          : <Link className="checkout-cancelled-secondary" to="/app/pricing">{t("See Pro plans")}</Link>}
        <p className="checkout-cancelled-reassurance"><LockKeyhole size={12} aria-hidden="true" />{t("Secure payment details handled by Stripe.")}</p>
      </div>
    </article>
    <footer className="checkout-cancelled-footer"><Link to="/app/pricing"><ArrowLeft size={13} aria-hidden="true" />{t("Back to plans")}</Link><SupportHelp topic="Payment" /></footer>
    <p className="checkout-cancelled-next"><CreditCard size={13} aria-hidden="true" />{t("After activation, we’ll take you back to your selected next step.")}</p>
  </section>;
}

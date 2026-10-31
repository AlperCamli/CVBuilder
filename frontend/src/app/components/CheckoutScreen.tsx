import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, Check, CreditCard, Loader2, LockKeyhole, PauseCircle, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "react-router";
import type { CheckoutTarget } from "../../content/pricing";
import { checkoutKey, type CheckoutAction, type CheckoutChoice, type CheckoutMascot, type CheckoutScreen as CheckoutScreenModel } from "../integration/checkout-screen";
import { formatMoney, type useRegionalPricing } from "../integration/regional-pricing";
import { translate as t } from "../localization/i18n";
import { PricingAvailability } from "./PricingAvailability";
import { SupportHelp } from "./SupportHelp";
import "./checkout-screen.css";

type Regional = ReturnType<typeof useRegionalPricing>;

const PLAN_NAME: Record<CheckoutTarget, string> = { weekly: "Weekly", monthly: "Monthly", annual: "Yearly" };
const BILLED: Record<CheckoutTarget, string> = { weekly: "billed weekly", monthly: "billed monthly", annual: "billed yearly" };
const FEATURES = ["Tailor your CV to every opportunity", "Unlimited PDF & DOCX exports", "AI improvements whenever you need them"];

/** The mascot card shared by every checkout state: start, cancelled, confirming and loading. */
export function CheckoutShell({ mascot, eyebrow, title, lead, status, footer, children }: {
  mascot: CheckoutMascot; eyebrow?: string; title: string; lead: string;
  status?: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  return <section className="checkout-screen" aria-labelledby="checkout-screen-title">
    {status && <p className="checkout-screen-status">{status}</p>}
    <article className="checkout-screen-card">
      <header className="checkout-screen-head">
        <div className="checkout-screen-copy">
          {eyebrow && <span className="checkout-screen-eyebrow"><Sparkles size={12} aria-hidden="true" />{eyebrow}</span>}
          <h1 id="checkout-screen-title">{title}</h1>
          <p>{lead}</p>
        </div>
        <img className="checkout-screen-mascot" src={`/images/designs/mascot/${mascot}.webp`} width="177" height="266" alt="" />
      </header>
      <div className="checkout-screen-body">{children}</div>
    </article>
    {footer}
  </section>;
}

export function CancelAnytime({ trial }: { trial: boolean }) {
  return <div className="checkout-screen-cancel">
    <span><ShieldCheck size={17} aria-hidden="true" /></span>
    <div>
      <strong>{t("Cancel anytime")}</strong>
      <p>{t(trial
        ? "Cancel before the 3 days end and you won’t be charged. It takes a couple of clicks in billing settings — no calls, no forms."
        : "No commitment. Cancel in a couple of clicks in billing settings and keep Pro until the end of the period you paid for.")}</p>
    </div>
  </div>;
}

interface CheckoutScreenProps {
  screen: CheckoutScreenModel;
  outcome: "start" | "cancel";
  regional: Regional;
  eligibility: boolean | null;
  /** Key of the action whose Stripe checkout is opening, if any. */
  opening: string | null;
  error: string | null;
  onCheckout: (choice: CheckoutChoice) => void;
}

export function CheckoutScreen({ screen, outcome, regional, eligibility, opening, error, onCheckout }: CheckoutScreenProps) {
  const prices = regional.prices;
  const amount = (plan: CheckoutTarget) => prices?.plans.find(item => item.code === plan)?.amount;
  const money = (value: number | undefined) => prices && value !== undefined ? formatMoney(value, prices.currency) : "—";
  const weekly = amount("weekly");
  const trialOffer = screen.offer === "trial";
  const label = (action: CheckoutAction) => action.kind === "pricing" ? t(action.label)
    : t(action.label, { plan: t(PLAN_NAME[action.plan]), price: money(amount(action.plan)) });

  const renderAction = (action: CheckoutAction, className: string) => {
    if (action.kind === "pricing") return <Link className={className} to="/app/pricing">{label(action)}{className.endsWith("primary") && <ArrowRight size={16} aria-hidden="true" />}</Link>;
    const busy = opening === checkoutKey(action);
    const disabled = opening !== null || !regional.ready || eligibility === null || (action.withTrial && eligibility !== true);
    return <button className={className} type="button" disabled={disabled} onClick={() => onCheckout({ plan: action.plan, withTrial: action.withTrial })}>
      {busy && <Loader2 className="animate-spin" size={16} aria-hidden="true" />}
      {busy ? t("Opening secure checkout…") : label(action)}
      {!busy && className.endsWith("primary") && <ArrowRight size={16} aria-hidden="true" />}
    </button>;
  };
  const linksToPlans = screen.primary.kind === "pricing" || screen.secondary.kind === "pricing";

  return <CheckoutShell
    mascot={screen.mascot} eyebrow={t(screen.eyebrow)} title={t(screen.title)} lead={t(screen.lead)}
    status={outcome === "cancel" && <><PauseCircle size={15} aria-hidden="true" />{t("Checkout wasn’t completed. You can still pick up here.")}</>}
    footer={<>
      <footer className="checkout-screen-footer">
        {!linksToPlans && <Link to="/app/pricing"><ArrowLeft size={13} aria-hidden="true" />{t("Back to plans")}</Link>}
        <SupportHelp topic="Payment" />
      </footer>
      {outcome === "cancel" && <p className="checkout-screen-next"><CreditCard size={13} aria-hidden="true" />{t("After activation, we’ll take you back to your selected next step.")}</p>}
    </>}>
    <PricingAvailability {...regional} />
    <div className="checkout-screen-offer">
      <div>
        <strong>{trialOffer ? t("3 days of Pro, on us") : t("Pro {{plan}}", { plan: t(PLAN_NAME[screen.offerPlan]) })}</strong>
        <p>{t(trialOffer ? "Full access from the moment you activate." : "Unlimited CVs, exports and AI tools.")}</p>
      </div>
      <div className="checkout-screen-price">
        <strong>{money(trialOffer ? 0 : amount(screen.offerPlan))}</strong>
        <span>{t(trialOffer ? "today" : BILLED[screen.offerPlan])}</span>
      </div>
    </div>
    <ul className="checkout-screen-features">
      {FEATURES.map(feature => <li key={feature}><span><Check size={13} aria-hidden="true" /></span>{t(feature)}</li>)}
    </ul>
    <CancelAnytime trial={trialOffer} />
    <p className="checkout-screen-terms">{trialOffer
      ? weekly !== undefined ? t("Card required to start. After 3 days, {{amount}} is billed weekly until you cancel.", { amount: money(weekly) })
        : t("Credit card required. Renewal terms will be shown before you activate your trial.")
      : t("Your plan renews automatically at the price shown until you cancel.")}</p>
    {error && <p role="alert" className="checkout-screen-error">{t(error)}</p>}
    {renderAction(screen.primary, "checkout-screen-primary")}
    {renderAction(screen.secondary, "checkout-screen-secondary")}
    <p className="checkout-screen-reassurance"><LockKeyhole size={12} aria-hidden="true" />{t("Secure payment details handled by Stripe.")}</p>
  </CheckoutShell>;
}

/** Shown after Stripe returns with a session while the backend confirms the subscription. */
export function CheckoutConfirming({ busy, error, onRetry }: { busy: boolean; error: string | null; onRetry: () => void }) {
  return <CheckoutShell mascot="celebrate" eyebrow={t("ALMOST DONE")} title={t("Confirming your subscription")}
    lead={t("This only takes a moment. We’ll take you back to your next step automatically.")}
    footer={<footer className="checkout-screen-footer checkout-screen-footer-center"><SupportHelp topic="Payment" /></footer>}>
    {error && <p role="alert" className="checkout-screen-error">{t(error)}</p>}
    {busy
      ? <p role="status" className="checkout-screen-waiting"><Loader2 className="animate-spin" size={16} aria-hidden="true" />{t("Confirming…")}</p>
      : <button className="checkout-screen-primary" type="button" onClick={onRetry}>{t("Check activation again")}<ArrowRight size={16} aria-hidden="true" /></button>}
  </CheckoutShell>;
}

/** Neutral first paint while the trial check runs, so no state flashes the wrong headline. */
export function CheckoutLoading() {
  return <CheckoutShell mascot="guide" title={t("Just a moment…")} lead={t("Getting your options ready.")}>
    <p role="status" className="checkout-screen-waiting"><Loader2 className="animate-spin" size={16} aria-hidden="true" />{t("Loading…")}</p>
  </CheckoutShell>;
}

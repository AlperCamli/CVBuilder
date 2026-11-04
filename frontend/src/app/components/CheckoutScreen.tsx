import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, BellRing, CalendarCheck, Check, ChevronDown, CreditCard, Download, Loader2, LockKeyhole, Mail, PauseCircle, ShieldCheck, Sparkles, Target } from "lucide-react";
import { Link } from "react-router";
import type { CheckoutTarget } from "../../content/pricing";
import type { BillingPlanResponseData } from "../integration/api-types";
import { checkoutKey, planDate, trialEndDate, welcomeContinueLabel, type CheckoutAction, type CheckoutChoice, type CheckoutMascot, type CheckoutScreen as CheckoutScreenModel } from "../integration/checkout-screen";
import { formatMoney, type useRegionalPricing } from "../integration/regional-pricing";
import type { PromotionPlanPrice } from "../integration/promotion-offer";
import type { CheckoutSource } from "../integration/subscription-flow";
import { localeCode, translate as t } from "../localization/i18n";
import { PricingAvailability } from "./PricingAvailability";
import { SupportHelp } from "./SupportHelp";
import "./checkout-screen.css";

type Regional = ReturnType<typeof useRegionalPricing>;

const PLAN_NAME: Record<CheckoutTarget, string> = { weekly: "Weekly", monthly: "Monthly", annual: "Yearly" };
const BILLED: Record<CheckoutTarget, string> = { weekly: "billed weekly", monthly: "billed monthly", annual: "billed yearly" };
const UNLOCKS = ["Tailor your CV to every opportunity", "Unlimited PDF & DOCX exports", "AI improvements whenever you need them", "Cover letters for every application"];

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

export function CancelAnytime({ trial, endDate }: { trial: boolean; endDate?: string }) {
  return <div className="checkout-screen-cancel">
    <span><ShieldCheck size={17} aria-hidden="true" /></span>
    <div>
      <strong>{t("Cancel anytime")}</strong>
      <p>{trial
        ? endDate ? t("Cancel anytime from your Profile in two clicks. If you cancel before {{date}}, you won’t be charged.", { date: endDate })
          : t("Cancel before the 3 days end and you won’t be charged. It takes a couple of clicks in billing settings — no calls, no forms.")
        : t("No commitment. Cancel in a couple of clicks in billing settings and keep Pro until the end of the period you paid for.")}</p>
    </div>
  </div>;
}

/** Today, the reminder, then the first charge: what happens after "Start my free trial". */
function TrialTimeline({ today, endDate, renewal }: { today: string; endDate: string; renewal: string | null }) {
  return <ol className="checkout-screen-timeline" aria-label={t("How your free trial works")}>
    <li>
      <span><Sparkles size={14} aria-hidden="true" /></span>
      <div><strong>{t("Today: {{amount}}", { amount: today })}</strong><p>{t("Full Pro access starts right away.")}</p></div>
    </li>
    <li>
      <span><BellRing size={14} aria-hidden="true" /></span>
      <div><strong>{t("Reminder email before your trial ends")}</strong><p>{t("So you can decide in time. No surprises.")}</p></div>
    </li>
    <li>
      <span><CalendarCheck size={14} aria-hidden="true" /></span>
      <div>
        <strong>{renewal ? t("{{date}}: {{price}}/week", { date: endDate, price: renewal }) : endDate}</strong>
        <p>{t("Your weekly plan starts, unless you cancel before then.")}</p>
      </div>
    </li>
  </ol>;
}

export function StripeTrust() {
  return <div className="checkout-screen-trust">
    <span className="checkout-screen-trust-icon"><LockKeyhole size={16} aria-hidden="true" /></span>
    <div>
      <strong>{t("Secure checkout powered by Stripe")}</strong>
      <p>{t("We never see or store your card details.")}</p>
    </div>
    <span className="checkout-screen-stripe" aria-hidden="true">stripe</span>
  </div>;
}

function CheckoutFaq({ trial, endDate, renewal }: { trial: boolean; endDate: string; renewal: string | null }) {
  const items = trial ? [
    { question: "Why do you need a card?", answer: t("It keeps the free trial to one per person and lets Pro continue without interruption if you stay. You pay nothing today, and your card details are stored by Stripe, not by us.") },
    { question: "When will I be charged?", answer: renewal
      ? t("Not today. If you keep Pro, your first payment of {{price}} is on {{date}}, then every week. We’ll email you a reminder before your trial ends.", { price: renewal, date: endDate })
      : t("Not today. If you keep Pro, your first weekly payment is on {{date}}. We’ll email you a reminder before your trial ends.", { date: endDate }) },
    { question: "How do I cancel?", answer: t("Open your Profile, choose Cancel trial and confirm. That’s it: no forms, no calls. You keep Pro until your trial ends.") },
  ] : [
    { question: "When will I be charged?", answer: t("When you confirm at Stripe. Your plan then renews at the price shown until you cancel.") },
    { question: "How do I cancel?", answer: t("Open your Profile, choose Cancel subscription and confirm. You keep Pro until the end of the period you paid for.") },
  ];
  return <section className="checkout-screen-faq" aria-labelledby="checkout-faq-title">
    <h2 id="checkout-faq-title">{t("Questions")}</h2>
    {items.map(item => <details key={item.question}>
      <summary>{t(item.question)}<ChevronDown size={15} aria-hidden="true" /></summary>
      <p>{item.answer}</p>
    </details>)}
  </section>;
}

interface CheckoutScreenProps {
  screen: CheckoutScreenModel;
  outcome: "start" | "cancel";
  regional: Regional;
  eligibility: boolean | null;
  /** Key of the action whose Stripe checkout is opening ("portal" for the billing portal), if any. */
  opening: string | null;
  error: string | null;
  /** Pricing page that keeps the paywall's next step and source. */
  plansPath: string;
  onCheckout: (choice: CheckoutChoice) => void;
  onPortal: () => void;
  /** Signs out so the emailed account can sign in (offer linked to another account). */
  onSwitchAccount?: () => void;
  /** The active emailed offer's first-month price for the offered plan. */
  promotion?: PromotionPlanPrice | null;
}

export function CheckoutScreen({ screen, outcome, regional, eligibility, opening, error, plansPath, onCheckout, onPortal, onSwitchAccount, promotion = null }: CheckoutScreenProps) {
  const prices = regional.prices;
  const amount = (plan: CheckoutTarget) => prices?.plans.find(item => item.code === plan)?.amount;
  const money = (value: number | undefined) => prices && value !== undefined ? formatMoney(value, prices.currency) : "—";
  const weekly = amount("weekly");
  const trialDays = prices?.plans.find(item => item.code === "weekly")?.trial_days;
  const endDate = trialEndDate(trialDays && trialDays > 0 ? trialDays : 3, localeCode());
  const renewal = weekly !== undefined ? money(weekly) : null;
  const trialOffer = screen.offer === "trial";
  const discount = screen.offer === "plan" && promotion?.code === screen.offerPlan ? promotion : null;
  const promoMoney = (value: number) => discount ? formatMoney(value, discount.currency) : "—";
  // "₺0" / "$0" rather than "₺0,00".
  const zero = prices ? new Intl.NumberFormat(localeCode(), { style: "currency", currency: prices.currency.toUpperCase(), currencyDisplay: "narrowSymbol", maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(0) : "—";
  const label = (action: CheckoutAction) => action.kind === "checkout"
    ? t(action.label, { plan: t(PLAN_NAME[action.plan]), price: money(amount(action.plan)) }) : t(action.label);

  const renderAction = (action: CheckoutAction, className: string) => {
    const arrow = className.endsWith("primary") && <ArrowRight size={16} aria-hidden="true" />;
    if (action.kind === "pricing") return <Link className={className} to={plansPath}>{label(action)}{arrow}</Link>;
    if (action.kind === "switch_account") return <button className={className} type="button" disabled={opening !== null} onClick={onSwitchAccount}>{label(action)}{arrow}</button>;
    const busy = opening === (action.kind === "portal" ? "portal" : checkoutKey(action));
    const disabled = opening !== null || (action.kind === "checkout" && (!regional.ready || eligibility === null || (action.withTrial && eligibility !== true)));
    return <button className={className} type="button" disabled={disabled}
      onClick={() => action.kind === "portal" ? onPortal() : onCheckout({ plan: action.plan, withTrial: action.withTrial })}>
      {busy && <Loader2 className="animate-spin" size={16} aria-hidden="true" />}
      {busy ? t(action.kind === "portal" ? "Redirecting..." : "Opening secure checkout…") : label(action)}
      {!busy && arrow}
    </button>;
  };
  const linksToPlans = screen.primary.kind === "pricing" || screen.secondary?.kind === "pricing";
  const actions = <>
    {error && <p role="alert" className="checkout-screen-error">{t(error)}</p>}
    {renderAction(screen.primary, "checkout-screen-primary")}
    {screen.secondary && renderAction(screen.secondary, "checkout-screen-secondary")}
  </>;

  return <CheckoutShell
    mascot={screen.mascot} eyebrow={t(screen.eyebrow)} title={t(screen.title)} lead={t(screen.lead)}
    status={outcome === "cancel" && screen.offer !== "none" && <><PauseCircle size={15} aria-hidden="true" />{t("Checkout wasn’t completed. You can still pick up here.")}</>}
    footer={<>
      <footer className="checkout-screen-footer">
        {!linksToPlans && screen.offer !== "none" && <Link to={plansPath}><ArrowLeft size={13} aria-hidden="true" />{t("Back to plans")}</Link>}
        <SupportHelp topic="Payment" />
      </footer>
      {outcome === "cancel" && screen.offer !== "none" && <p className="checkout-screen-next"><CreditCard size={13} aria-hidden="true" />{t("After activation, we’ll take you back to your selected next step.")}</p>}
    </>}>
    {screen.offer === "none" ? actions : <>
      <PricingAvailability {...regional} />
      {trialOffer
        ? <TrialTimeline today={zero} endDate={endDate} renewal={renewal} />
        : <div className="checkout-screen-offer">
          <div>
            <strong>{t("Pro {{plan}}", { plan: t(PLAN_NAME[screen.offerPlan]) })}</strong>
            <p>{t("Unlimited CVs, exports and AI tools.")}</p>
          </div>
          {discount
            ? <div className="checkout-screen-price checkout-screen-price-promo">
              <span className="checkout-screen-price-was"><span className="sr-only">{t("Regular price:")}{" "}</span><s>{promoMoney(discount.amount)}</s></span>
              <strong><span className="sr-only">{t("First month:")}{" "}</span>{promoMoney(discount.discounted_amount)}</strong>
              <span>{t("first month")}</span>
            </div>
            : <div className="checkout-screen-price">
              <strong>{money(amount(screen.offerPlan))}</strong>
              <span>{t(BILLED[screen.offerPlan])}</span>
            </div>}
        </div>}
      <CancelAnytime trial={trialOffer} endDate={endDate} />
      {actions}
      <p className="checkout-screen-terms">{trialOffer
        ? weekly !== undefined ? t("Card required to start. After 3 days, {{amount}} is billed weekly until you cancel.", { amount: money(weekly) })
          : t("Credit card required. Renewal terms will be shown before you activate your trial.")
        : discount ? t("{{percent}}% off your first month, charged today. Then {{price}}/month until you cancel.", { percent: discount.percent_off, price: promoMoney(discount.amount) })
          : t("Your plan renews automatically at the price shown until you cancel.")}</p>
      <StripeTrust />
      <section className="checkout-screen-unlocks" aria-labelledby="checkout-unlocks-title">
        <h2 id="checkout-unlocks-title">{t("What you unlock")}</h2>
        <ul className="checkout-screen-features">
          {UNLOCKS.map(feature => <li key={feature}><span><Check size={13} aria-hidden="true" /></span>{t(feature)}</li>)}
        </ul>
      </section>
      <CheckoutFaq trial={trialOffer} endDate={endDate} renewal={renewal} />
    </>}
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

const WELCOME_BENEFITS = [
  { Icon: Target, title: "Tailor your CV to every job", text: "Paste a job posting, get a matched CV in about 2 minutes." },
  { Icon: Download, title: "Unlimited PDF & DOCX downloads", text: "Download every version you make." },
  { Icon: Sparkles, title: "AI improvements", text: "Rewrite any section in one click." },
  { Icon: Mail, title: "Cover letters", text: "Written for each application." },
];

/** What Pro includes: the welcome after checkout, and the cancel screens. */
export function ProBenefits() {
  return <ul className="checkout-screen-benefits">
    {WELCOME_BENEFITS.map(({ Icon, title, text }) => <li key={title}>
      <span><Icon size={16} aria-hidden="true" /></span>
      <div><strong>{t(title)}</strong><p>{t(text)}</p></div>
    </li>)}
  </ul>;
}

/** After Stripe confirms: one welcome for a trial or Pro (only the chip and the last line differ), then one button back to the task. */
export function CheckoutWelcome({ billing, regional, source, destination, onContinue }: {
  billing: Pick<BillingPlanResponseData, "plan_code" | "subscription_status" | "current_period_end">;
  regional: Regional; source: CheckoutSource | null; destination: string; onContinue: () => void;
}) {
  const trial = billing.subscription_status === "trialing";
  const date = planDate(billing.current_period_end, localeCode());
  const weekly = regional.prices?.plans.find(item => item.code === "weekly")?.amount;
  const price = regional.prices && weekly !== undefined ? formatMoney(weekly, regional.prices.currency) : null;
  const plan = billing.plan_code in PLAN_NAME ? PLAN_NAME[billing.plan_code as CheckoutTarget] : null;
  const terms = trial
    ? date
      ? price ? t("Free until {{date}}, then {{price}} a week. We’ll email you before your trial ends.", { date, price })
        : t("Free until {{date}}. We’ll email you before your trial ends.", { date })
      : t("We’ll email you before your trial ends.")
    : date && plan ? t("Your {{plan}} plan renews on {{date}}. Manage it anytime in Profile.", { plan: t(plan), date })
      : t("Manage your plan anytime in Profile.");
  return <CheckoutShell mascot="celebrate" eyebrow={t(trial ? "FREE TRIAL STARTED" : "PRO IS ACTIVE")}
    title={t("Welcome to Pro. Everything is unlocked.")} lead={t("Here’s what you can do now.")}
    footer={<footer className="checkout-screen-footer checkout-screen-footer-center"><SupportHelp topic="Payment" /></footer>}>
    <ProBenefits />
    <button className="checkout-screen-primary" type="button" onClick={onContinue}>
      {t(welcomeContinueLabel(source, destination))}<ArrowRight size={16} aria-hidden="true" />
    </button>
    <p className="checkout-screen-terms checkout-screen-terms-center">{terms}</p>
  </CheckoutShell>;
}

/** Neutral first paint while the trial check runs, so no state flashes the wrong headline. */
export function CheckoutLoading() {
  return <CheckoutShell mascot="guide" title={t("Just a moment…")} lead={t("Getting your options ready.")}>
    <p role="status" className="checkout-screen-waiting"><Loader2 className="animate-spin" size={16} aria-hidden="true" />{t("Loading…")}</p>
  </CheckoutShell>;
}

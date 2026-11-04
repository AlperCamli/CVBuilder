import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, BadgePercent, CalendarCheck, CreditCard, Loader2, PauseCircle, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "react-router";
import type { CancelOffer } from "../integration/api-types";
import { cancelOfferView, planName, type CancelOfferView } from "../integration/cancel-offer";
import { localeCode, translate as t } from "../localization/i18n";
import { CheckoutShell, ProBenefits, StripeTrust } from "./CheckoutScreen";
import { SupportHelp } from "./SupportHelp";
import "./cancel-offer.css";

const PROFILE_PATH = "/app/profile";

function ProfileFooter() {
  return <footer className="checkout-screen-footer">
    <Link to={PROFILE_PATH}><ArrowLeft size={13} aria-hidden="true" />{t("Back to Profile")}</Link>
    <SupportHelp topic="Payment" />
  </footer>;
}

interface Step { Icon: typeof CreditCard; title: string; text: string }

// Per kind: a trial pays the discounted month now (then the trial ends); paid weekly moves to the offered plan when
// its paid week ends; monthly and annual keep their plan with the next renewal discounted. Nothing is charged today
// for the paid kinds.
function copyFor(offer: CancelOffer, view: CancelOfferView) {
  const { percent, firstCharge: first, price, periodEnd: date, chargeDate, nextDate } = view;
  const plan = t(view.planName);
  const period = t(view.period);
  if (offer.kind === "checkout") return {
    title: percent === 50 ? t("Still job hunting? Keep Pro for half price.") : t("Still job hunting? Keep Pro at {{percent}}% off.", { percent }),
    lead: t("Your first month is {{percent}}% off. Keep tailoring your CV for every application.", { percent }),
    status: t("Your free trial is still active until {{date}}.", { date }),
    priceNote: t("first month"),
    steps: [
      { Icon: CreditCard, title: t("Today: {{amount}}", { amount: first }), text: t("Pro {{plan}} starts right away. Your free trial ends, and the weekly price is never charged.", { plan }) },
      { Icon: CalendarCheck, title: t("{{date}}: {{price}}", { date: nextDate, price }), text: t("Then every month until you cancel.") },
      { Icon: ShieldCheck, title: t("Cancel anytime"), text: t("From your Profile, in two clicks.") },
    ] satisfies Step[],
    accept: t("Keep Pro at {{percent}}% off", { percent }),
    terms: t("Keeping Pro starts the {{plan}} plan today: {{first}} now, then {{price}} every month until you cancel. Your free trial ends at once and its weekly price is never charged.", { plan, first, price }),
  };
  if (offer.kind === "switch_at_period_end") return {
    title: percent === 50 ? t("Still job hunting? Get a month of Pro for half price.") : t("Still job hunting? Get {{percent}}% off a month of Pro.", { percent }),
    lead: t("Your weekly plan runs until {{date}}. Then switch to {{plan}} and pay {{first}} for your first month.", { date, plan, first }),
    status: t("Your weekly plan is active until {{date}}.", { date }),
    priceNote: t("first month"),
    steps: [
      { Icon: Sparkles, title: t("Today: nothing to pay"), text: t("Your weekly plan stays active until {{date}}.", { date }) },
      { Icon: CalendarCheck, title: t("{{date}}: {{price}}", { date: chargeDate, price: first }), text: t("Pro {{plan}} starts with {{percent}}% off the first month. No more weekly charges.", { plan, percent }) },
      { Icon: ShieldCheck, title: t("{{date}}: {{price}}", { date: nextDate, price }), text: t("Then every month until you cancel.") },
    ] satisfies Step[],
    accept: t("Switch to {{plan}} at {{percent}}% off", { plan, percent }),
    terms: t("Your weekly plan stays active until {{date}} and is not renewed. On {{date}} your card is charged {{first}} for your first month of Pro {{plan}}, then {{price}} every month until you cancel. Nothing is charged today.", { date, first, plan, price }),
  };
  return {
    title: offer.plan_code === "monthly" && percent === 50 ? t("Still job hunting? Your next month is half price.") : t("Stay on Pro with {{percent}}% off your next {{period}}.", { percent, period }),
    lead: t("Keep Pro and pay {{first}} instead of {{price}} when your plan renews on {{date}}.", { first, price, date }),
    status: t("Your {{plan}} plan renews on {{date}}.", { plan, date }),
    priceNote: t("next {{period}}", { period }),
    steps: [
      { Icon: Sparkles, title: t("Today: nothing to pay"), text: t("Pro stays active, nothing else changes.") },
      { Icon: CalendarCheck, title: t("{{date}}: {{price}}", { date: chargeDate, price: first }), text: t("Your next {{period}}, {{percent}}% off.", { period, percent }) },
      { Icon: ShieldCheck, title: t("{{date}}: {{price}}", { date: nextDate, price }), text: t("Then the regular price until you cancel.") },
    ] satisfies Step[],
    accept: t("Keep Pro at {{percent}}% off", { percent }),
    terms: t("Your renewal on {{date}} costs {{first}} instead of {{price}}. After that, {{price}} every {{period}} until you cancel. Nothing is charged today.", { date, first, price, period }),
  };
}

/**
 * The one screen between "Cancel" and Stripe's cancellation: the one-time offer, with cancelling as a full-width
 * button right under it. Cancelling stays available whatever happens to the offer.
 */
export function CancelOfferScreen({ offer, busy, error, offerGone, returned, onAccept, onCancel }: {
  offer: CancelOffer;
  /** Which choice is waiting on the server. */
  busy: "accept" | "cancel" | null;
  error: string | null;
  /** The server no longer offers it: only cancelling is left. */
  offerGone: boolean;
  /** Back from Stripe without paying (a trial's checkout). */
  returned: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const view = cancelOfferView(offer, localeCode());
  const copy = copyFor(offer, view);
  const checkout = offer.kind === "checkout";
  const status: ReactNode = returned
    ? <><PauseCircle size={15} aria-hidden="true" />{t("Payment wasn’t completed. Your free trial hasn’t changed.")}</>
    : <><CalendarCheck size={15} aria-hidden="true" />{copy.status}</>;
  return <CheckoutShell mascot="guide" eyebrow={t("ONE-TIME OFFER")} title={copy.title} lead={copy.lead} status={status} footer={<ProfileFooter />}>
    <div className="checkout-screen-offer cancel-offer-card">
      <span className="cancel-offer-badge"><BadgePercent size={13} aria-hidden="true" />{t("{{percent}}% OFF", { percent: view.percent })}</span>
      <div>
        <strong>{t("Pro {{plan}}", { plan: t(view.planName) })}</strong>
        <p>{t("Unlimited CVs, exports and AI tools.")}</p>
      </div>
      <div className="checkout-screen-price checkout-screen-price-promo">
        <span className="checkout-screen-price-was"><span className="sr-only">{t("Regular price:")}{" "}</span><s>{view.price}</s></span>
        <strong><span className="sr-only">{t("Discounted price:")}{" "}</span>{view.firstCharge}</strong>
        <span>{copy.priceNote}</span>
      </div>
    </div>
    {checkout && view.weekComparison && <p className="cancel-offer-compare"><Sparkles size={14} aria-hidden="true" />{t("A whole month for about the price of one week.")}</p>}
    <ol className="checkout-screen-timeline cancel-offer-timeline" aria-label={t("What happens if you keep Pro")}>
      {copy.steps.map(({ Icon, title, text }) => <li key={title}>
        <span><Icon size={14} aria-hidden="true" /></span>
        <div><strong>{title}</strong><p>{text}</p></div>
      </li>)}
    </ol>
    {error && <p role="alert" className="checkout-screen-error">{t(error)}</p>}
    {!offerGone && <button className="checkout-screen-primary" type="button" disabled={busy !== null} onClick={onAccept}>
      {busy === "accept"
        ? <><Loader2 className="animate-spin" size={16} aria-hidden="true" />{t(checkout ? "Opening secure checkout…" : "Applying your offer…")}</>
        : <>{copy.accept}<ArrowRight size={16} aria-hidden="true" /></>}
    </button>}
    <CancelButton busy={busy} onCancel={onCancel} trial={checkout} />
    <p className="checkout-screen-terms">{copy.terms}</p>
    {checkout && <StripeTrust />}
  </CheckoutShell>;
}

function CancelButton({ busy, onCancel, trial }: { busy: "accept" | "cancel" | null; onCancel: () => void; trial: boolean }) {
  return <button className="checkout-screen-secondary cancel-offer-decline" type="button" disabled={busy !== null} onClick={onCancel}>
    {busy === "cancel"
      ? <><Loader2 className="animate-spin" size={16} aria-hidden="true" />{t("Opening cancellation…")}</>
      : trial ? t("No thanks, cancel my trial") : t("No thanks, cancel my plan")}
  </button>;
}

/** No offer for this plan (e.g. annual): what Pro includes, then a plain choice. */
export function CancelBenefitsScreen({ trial, planCode, periodEnd, busy, error, onKeep, onCancel }: {
  trial: boolean;
  planCode: CancelOffer["plan_code"] | null;
  periodEnd: string | null;
  busy: "cancel" | null;
  error: string | null;
  onKeep: () => void;
  onCancel: () => void;
}) {
  const date = periodEnd ?? "";
  const lead = trial
    ? t("Your free trial stays active until {{date}} either way.", { date })
    : planCode ? t("Your {{plan}} plan stays active until {{date}} either way.", { plan: t(planName(planCode)), date })
      : t("Your plan stays active until the end of the period you paid for.");
  return <CheckoutShell mascot="thinking" eyebrow={t("BEFORE YOU GO")} title={t("Are you sure? Here’s what you’d lose.")} lead={lead} footer={<ProfileFooter />}>
    <ProBenefits />
    {error && <p role="alert" className="checkout-screen-error">{t(error)}</p>}
    <button className="checkout-screen-primary" type="button" disabled={busy !== null} onClick={onKeep}>{t("Keep Pro")}<ArrowRight size={16} aria-hidden="true" /></button>
    <CancelButton busy={busy} onCancel={onCancel} trial={trial} />
  </CheckoutShell>;
}

/** After a paid plan's offer is applied (nothing charged today): what changes and when, and what Pro keeps. */
export function CancelOfferAccepted({ offer, onContinue }: { offer: CancelOffer; onContinue: () => void }) {
  const view = cancelOfferView(offer, localeCode());
  const plan = t(view.planName);
  const lead = offer.kind === "switch_at_period_end"
    ? t("Your weekly plan runs until {{date}}. Then Pro {{plan}} starts at {{first}} for the first month.", { date: view.periodEnd, plan, first: view.firstCharge })
    : t("Your renewal on {{date}} costs {{first}} instead of {{price}}.", { date: view.periodEnd, first: view.firstCharge, price: view.price });
  return <CheckoutShell mascot="celebrate" eyebrow={t("OFFER APPLIED")} title={t("You’re all set. Pro stays on.")} lead={lead} footer={<ProfileFooter />}>
    <ProBenefits />
    <button className="checkout-screen-primary" type="button" onClick={onContinue}>{t("Go to my CVs")}<ArrowRight size={16} aria-hidden="true" /></button>
    <p className="checkout-screen-terms checkout-screen-terms-center">{t("Manage your plan anytime in Profile.")}</p>
  </CheckoutShell>;
}

/** The portal is opening: a short wait, and a way back if Stripe cannot be reached. */
export function CancelTrialRedirect({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return <CheckoutShell mascot="guide" title={error ? t("We couldn’t open the cancellation") : t("Just a moment…")}
    lead={error ? t("Your plan hasn’t changed. Try again, or come back to it from your Profile.") : t("Opening cancellation…")}
    footer={<ProfileFooter />}>
    {error
      ? <>
        <p role="alert" className="checkout-screen-error">{t(error)}</p>
        <button className="checkout-screen-primary" type="button" onClick={onRetry}>{t("Try again")}<ArrowRight size={16} aria-hidden="true" /></button>
      </>
      : <p role="status" className="checkout-screen-waiting"><Loader2 className="animate-spin" size={16} aria-hidden="true" />{t("Loading…")}</p>}
  </CheckoutShell>;
}

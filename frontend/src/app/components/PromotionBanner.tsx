import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Info, X } from "lucide-react";
import { formatMoney } from "../integration/regional-pricing";
import { formatCountdown, remainingMs, type PromotionOffer, type PromotionOfferState, type PromotionStatus } from "../integration/promotion-offer";
import { localeCode, translate as t } from "../localization/i18n";
import "./promotion.css";

const NOTICE: Record<Exclude<PromotionStatus, "active">, string> = {
  ended: "This offer has ended. Regular prices apply.",
  upcoming: "Your offer opens on {{date}}. Until then, regular prices apply.",
  redeemed: "You’ve already used this offer. Regular prices apply.",
  ineligible: "This offer isn’t available for this account. Regular prices apply.",
  invalid: "We couldn’t find this offer. The link may be incomplete. Regular prices apply.",
};

const dateTime = (iso: string) => new Date(iso).toLocaleString(localeCode(), { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

export function promotionNoticeText(status: Exclude<PromotionStatus, "active">, offer: PromotionOffer | null): string {
  return t(NOTICE[status], { date: offer?.promotion ? dateTime(offer.promotion.starts_at) : "" });
}

/** The live offer: what it is, what it costs after, and a countdown to this recipient's own ends_at. */
function ActiveBanner({ offer, now }: { offer: PromotionOffer; now: number }) {
  const promotion = offer.promotion!;
  const plan = offer.prices?.plans.find(item => promotion.plan_codes.includes(item.code));
  const money = (value: number) => formatMoney(value, offer.prices!.currency);
  return <section className="promo-banner" aria-labelledby="promo-banner-title">
    <img className="promo-banner-mascot" src="/images/designs/mascot/celebrate.webp" width="38" height="57" alt="" />
    <div className="promo-banner-copy">
      <p id="promo-banner-title" className="promo-banner-title">{promotion.plan_codes.length === 1 && promotion.plan_codes[0] === "monthly"
        ? t("{{percent}}% off your first month of Monthly Pro", { percent: promotion.percent_off })
        : t("{{percent}}% off Pro", { percent: promotion.percent_off })}</p>
      {plan && <p className="promo-banner-terms">
        {t("Your personal offer: {{price}} for the first month, then {{regular}}/month. Cancel anytime.", { price: money(plan.discounted_amount), regular: money(plan.amount) })}
      </p>}
    </div>
    <p className="promo-banner-timer">
      <span aria-hidden="true">{t("Ends in")}</span>
      <time className="promo-countdown" dateTime={promotion.ends_at} aria-hidden="true">{formatCountdown(remainingMs(offer, now))}</time>
      <span className="promo-sr-only">{t("Offer ends {{date}}", { date: dateTime(promotion.ends_at) })}</span>
    </p>
  </section>;
}

/**
 * Banner for an emailed offer on the pricing pages. Its slot is reserved as soon as a token is
 * known, and the countdown uses fixed-width digits, so neither the lookup nor the ticking moves the
 * page. Other outcomes show a short dismissible notice next to the regular prices.
 */
export function PromotionBanner({ promo, layout }: { promo: PromotionOfferState; layout: "band" | "card" }) {
  useTranslation();
  const { state, status, now, dismissed, dismiss } = promo;
  const [announcement, setAnnouncement] = useState("");
  const wasActive = useRef(false);
  useEffect(() => {
    if (status === "active") wasActive.current = true;
    // Said once when the countdown runs out on this page.
    else if (status === "ended" && wasActive.current) setAnnouncement(t(NOTICE.ended));
  }, [status]);
  if (state.phase === "none") return null;
  return <div className={`promo-slot promo-slot-${layout}`}>
    <p className="promo-sr-only" role="status">{announcement}</p>
    {state.phase === "loading"
      ? <div className="promo-banner promo-banner-pending" aria-hidden="true" />
      : status === "active"
        ? <ActiveBanner offer={state.offer} now={now} />
        : !dismissed && status && <div className="promo-notice">
          <Info size={16} aria-hidden="true" />
          <p>{promotionNoticeText(status, state.offer)}</p>
          <button type="button" onClick={dismiss} aria-label={t("Dismiss")}><X size={15} aria-hidden="true" /></button>
        </div>}
  </div>;
}

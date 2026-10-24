import { checkoutPath, rememberOnboardingTemplate, ONBOARDING_ENTRY_PATH } from "../../integration/subscription-flow";
import { publicPath } from "../../localization/i18n";
import { useRegionalPricing, formatMoney } from "../../integration/regional-pricing";
import { PricingAvailability } from "../../components/PricingAvailability";
import { translate as t } from "../../localization/i18n";
import { useTranslation } from "react-i18next";
import { CV_START_PATH } from "../../design-tools";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  FileText,
  LayoutGrid,
  Menu,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  isCheckoutTarget,
  PLAN_CARDS,
  type CheckoutTarget,
} from "../../../content/pricing";
import {
  clearPendingCheckout,
  setPendingCheckout,
} from "../../integration/pending-checkout";
import {
  BILLING,
  CONCEPTS,
  isNewConcept,
  NARROW_SENTENCE,
  ORIGINAL_SENTENCE,
  TAILORED_SENTENCE,
  type Concept,
} from "./concepts";
import { weeklyPriceComparison } from "./weekly-pricing";

export function StartLink({
  children = (
    <>
      {t("Start Free Trial")}{" "}<ArrowRight size={17} />
    </>
  ),
  className = "cv-button",
  to = CV_START_PATH,
  templateSlug,
}: {
  children?: ReactNode;
  className?: string;
  to?: string;
  templateSlug?: string;
}) {
  useTranslation();
  return (
    <Link
      to={templateSlug ? `${to}${to.includes("?") ? "&" : "?"}template=${encodeURIComponent(templateSlug)}` : to}
      state={{ from: "/app/create" }}
      className={className}
      onClick={() => { clearPendingCheckout(); if (templateSlug) rememberOnboardingTemplate(templateSlug); }}
    >
      {children}
    </Link>
  );
}

export function ReviewBar({
  concept,
  pricing = false,
}: {
  concept?: Concept;
  pricing?: boolean;
}) {
  useTranslation();
  const { search } = useLocation();
  return (
    <div className="cv-review-bar">
      <Link to="/designs" className="cv-review-home">
        <LayoutGrid size={14} />
        <span>{t("Design explorations")}</span>
      </Link>
      <nav aria-label={t("Design alternatives")}>
        {CONCEPTS.filter(
          (item) =>
            isNewConcept(item.id) === (concept ? isNewConcept(concept) : true),
        ).map((item) => (
          <Link
            key={item.id}
            to={`/designs/${item.id}${pricing ? "/pricing" : ""}${pricing ? search : ""}`}
            aria-current={concept === item.id ? "page" : undefined}
          >
            <span>{item.number}</span> {t(item.label)}
          </Link>
        ))}
      </nav>
      <Link to={publicPath("/")} className="cv-current-link">
        {t("Current site")}{" "}<ArrowUpRight size={13} />
      </Link>
    </div>
  );
}

export function DesignNav({
  concept,
  pricing = false,
}: {
  concept: Concept;
  pricing?: boolean;
}) {
  useTranslation();
  const [open, setOpen] = useState(false);
  const base = `/designs/${concept}`;
  return (
    <header className="cv-header cv-wrap">
      <Link to={base} className="cv-wordmark" aria-label={t("JobSpecificCV home")}>
        <span className="cv-brand-icon">
          <FileText size={21} />
        </span>
        {"jobspecific"}<span>{t("CV")}</span>
        <span className="cv-brand-dot">{"."}</span>
      </Link>
      <nav
        className={`cv-navigation ${open ? "is-open" : ""}`}
        aria-label={t("Main navigation")}
        id="concept-navigation"
      >
        <Link to={`${base}#how-it-works`} onClick={() => setOpen(false)}>
          {t("How it works")}</Link>
        <Link to={`${base}#example`} onClick={() => setOpen(false)}>
          {t("See the difference")}</Link>
        <Link
          to={`${base}/pricing`}
          aria-current={pricing ? "page" : undefined}
          onClick={() => setOpen(false)}
        >
          {t("Pricing")}</Link>
        <Link to="/career-advice">
          {t("Resources")}{" "}<ArrowUpRight size={12} />
        </Link>
        <Link to="/signin" className="cv-mobile-signin">
          {t("Sign in")}</Link>
      </nav>
      <div className="cv-nav-actions">
        <Link to="/signin" className="cv-signin">
          {t("Sign in")}</Link>
        <StartLink className="cv-button cv-button-small">
          {t("Start Free Trial")}{" "}<ArrowUpRight size={15} />
        </StartLink>
      </div>
      <button
        className="cv-menu-toggle"
        aria-controls="concept-navigation"
        aria-expanded={open}
        aria-label={open ? t("Close navigation") : t("Open navigation")}
        onClick={() => setOpen(!open)}
      >
        {open ? <X /> : <Menu />}
      </button>
    </header>
  );
}

export function DesignShell({
  concept,
  pricing = false,
  children,
}: {
  concept: Concept;
  pricing?: boolean;
  children: ReactNode;
}) {
  useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const { pathname, hash } = useLocation();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (hash)
        document
          .getElementById(hash.slice(1))
          ?.scrollIntoView({ block: "start" });
      else window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);
  useEffect(() => {
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("IntersectionObserver" in window)
    )
      return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("cv-entered");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    root.current
      ?.querySelectorAll(".cv-reveal")
      .forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [pathname]);
  return (
    <div ref={root} className={`cv-concept cv-${concept}`}>
      <a href="#concept-main" className="cv-skip-link">
        {t("Skip to content")}</a>
      <ReviewBar concept={concept} pricing={pricing} />
      <DesignNav concept={concept} pricing={pricing} />
      <main id="concept-main">{children}</main>
      <DesignFooter concept={concept} />
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  useTranslation();
  return <div className="cv-eyebrow">{children}</div>;
}

export function ExampleDocument({
  compact = false,
  editorial = false,
}: {
  compact?: boolean;
  editorial?: boolean;
}) {
  useTranslation();
  return (
    <div
      className={`cv-document ${compact ? "cv-document-compact" : ""} ${editorial ? "cv-document-editorial" : ""}`}
    >
      <div className="cv-document-top">
        <span>{t("CURRICULUM VITAE")}</span>
        <span>{t("ILLUSTRATIVE SAMPLE")}</span>
      </div>
      <h3>
        {t("Alex Morgan")}<span>{t("Data Analyst")}</span>
      </h3>
      <div className="cv-document-contact">
        {t("London, UK")}{" "}<span>{"·"}</span> {" "}{t("alex@example.com")}</div>
      <section>
        <h4>{t("Profile")}</h4>
        <p>
          {t("Turning sales data into clear, useful weekly reports. Experienced in Excel reporting and communicating trends.")}</p>
      </section>
      <section>
        <h4>{t("Experience")}</h4>
        <div className="cv-document-role">
          <strong>{t("Reporting Assistant")}</strong>
          <span>{"2023–2025"}</span>
        </div>
        <p className="cv-document-employer">{t("Example Company · London")}</p>
        <p className="cv-document-highlight">
          {t("Prepared weekly")}{" "}<mark>{t("Excel reports")}</mark> {" "}{t("to track")}{" "}
          <mark>{t("sales performance")}</mark> {" "}{t("and highlight trends.")}</p>
        <p>{t("Organized sales records and shared reports with the team.")}</p>
      </section>
      <section>
        <h4>{t("Skills")}</h4>
        <p>
          {t("Excel &nbsp; / &nbsp; Sales analysis &nbsp; / &nbsp; Weekly reporting")}</p>
      </section>
      {!compact && (
        <section>
          <h4>{t("Education")}</h4>
          <strong>{t("BSc Business Management")}</strong>
          <p>{t("Example University · 2023")}</p>
        </section>
      )}
      <div className="cv-document-bottom">
        <span>{t("ALEX MORGAN")}</span>
        <span>{"01"}</span>
      </div>
    </div>
  );
}

export function Transformation({ compact = false }: { compact?: boolean }) {
  useTranslation();
  const [confirmed, setConfirmed] = useState(true);
  return (
    <div
      className={`cv-transformation ${compact ? "cv-transformation-compact" : ""}`}
    >
      <div className="cv-example-heading">
        <span>
          <span className="cv-status-dot" /> {" "}{t("Data Analyst application")}</span>
        <span>{t("Illustrative example")}</span>
      </div>
      <div className="cv-requirements">
        <span>{t("The role asks for")}</span>
        <div>
          <span>{t("Excel")}</span>
          <span>{t("Sales analysis")}</span>
          <span>{t("Weekly reporting")}</span>
          <span className="cv-unsupported">{t("SQL · needs evidence")}</span>
        </div>
      </div>
      <div className="cv-sentence-grid">
        <div className="cv-sentence-before">
          <span className="cv-small-label">{t("YOUR ORIGINAL EXPERIENCE")}</span>
          <p>{"“"}{ORIGINAL_SENTENCE}{"”"}</p>
          <span className="cv-sentence-note">{t("A good starting point.")}</span>
        </div>
        <div className="cv-sentence-after">
          <span className="cv-small-label">
            <Sparkles size={13} /> {" "}{t("TAILORED TO THE ROLE")}</span>
          <p aria-live="polite">
            {"“"}{confirmed ? TAILORED_SENTENCE : NARROW_SENTENCE}{"”"}</p>
          <span className="cv-sentence-note">
            <Check size={14} /> {" "}{t("Your experience, with a clearer focus.")}</span>
        </div>
      </div>
      <label className="cv-evidence-checkbox">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>{t("I tracked performance and identified trends in this role.")}</span>
      </label>
      <div className="cv-change-explanation">
        <ShieldCheck size={18} />
        <p>
          {confirmed
            ? t("Excel, reporting frequency, and purpose are easier to spot. The wording reflects the experience confirmed above.")
            : t("The wording stays narrower without that confirmation. Only the experience you can support belongs on your CV.")}{" "}
          {t("SQL stays out until you add evidence.")}</p>
      </div>
    </div>
  );
}

type PricingCardsProps = {
  concept: Concept;
  teaser?: boolean;
  guided?: { onTrial?: () => void; pricingPath: string };
};

export function PricingCards(props: PricingCardsProps) {
  const regional = useRegionalPricing();
  return <RegionalPricingCards {...props} regional={regional} />;
}

/** Share the landing page's pricing response with its regional company logos. */
export function RegionalPricingCards({
  concept,
  teaser = false,
  guided,
  regional,
}: PricingCardsProps & {
  regional: ReturnType<typeof useRegionalPricing>;
}) {
  useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedBilling = searchParams.get("billing");
  // Static HTML is generated for the default selection. Apply query preferences
  // after hydration so direct ?billing=annual links do not mismatch that HTML.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [teaserPeriod, setTeaserPeriod] = useState<CheckoutTarget>("monthly");
  const period = teaser
    ? teaserPeriod
    : hydrated && isCheckoutTarget(selectedBilling)
      ? selectedBilling
      : "monthly";
  const selected = regional.prices?.plans.find(plan => plan.code === period);
  const weeklyAmount = selected ? Math.round(selected.amount * (period === "monthly" ? 12 / 52 : period === "annual" ? 1 / 52 : 1)) : 0;
  const weeklyBase = regional.prices?.plans.find(plan => plan.code === "weekly")?.amount ?? 0;
  const money = (amount: number) => regional.ready ? formatMoney(amount, regional.prices!.currency) : "—";
  const price = { ...BILLING[period], label: t(BILLING[period].label), price: money(selected?.amount ?? 0), renewal: t(BILLING[period].renewal), interval: t(BILLING[period].interval) };
  const weekly = { price: money(weeklyAmount), saving: money(weeklyBase - weeklyAmount), savingsPercent: weeklyBase ? Math.round((1 - weeklyAmount / weeklyBase) * 100) : 0 };
  const monthly = regional.prices?.plans.find(plan => plan.code === "monthly")?.amount ?? 0;
  const annual = regional.prices?.plans.find(plan => plan.code === "annual")?.amount ?? 0;
  const annualSavings = monthly ? Math.round((1 - annual / (monthly * 12)) * 100) : 0;
  const monthlySavings = weeklyBase ? Math.round((1 - Math.round(monthly * 12 / 52) / weeklyBase) * 100) : 0;
  const selectPeriod = (next: CheckoutTarget) => {
    setTeaserPeriod(next);
    if (!teaser) {
      const params = new URLSearchParams(searchParams);
      params.set("billing", next);
      setSearchParams(
        params,
        { replace: true, preventScrollReset: true },
      );
    }
  };
  const choosePro = () => {
    if (!regional.ready) return;
    // The paid weekly choice is explicit: do not imply unverified trial terms.
    setPendingCheckout({
      plan_code: period,
      with_trial: false,
      return_path: ONBOARDING_ENTRY_PATH,
    });
    navigate("/signup?purchase=1", { state: { from: checkoutPath({ plan_code: period, with_trial: false, return_path: ONBOARDING_ENTRY_PATH, auto: true }) } });
  };
  const proFeatures = [
    "Unlimited tailored CVs",
    "Unlimited PDF & DOCX exports",
    "Unlimited AI actions",
    "Review and edit every version",
  ];
  return (
    <div className={`cv-pricing-module ${teaser ? "cv-pricing-teaser" : ""}`}>
      <PricingAvailability {...regional} />
      <div className="cv-billing-controls">
        <span>{t("Choose your Pro billing period")}</span>
        <div
          className="cv-billing-selector"
          role="group"
          aria-label={t("Pro billing period")}
        >
          {(Object.keys(BILLING) as CheckoutTarget[]).map((key) => (
            <button
              key={key}
              onClick={() => selectPeriod(key)}
              aria-pressed={period === key}
            >
              {t(BILLING[key].label)}
              {guided && regional.ready && monthlySavings > 0 && key === "monthly" && (
                <span>{t("Save {{percent}}%", { percent: monthlySavings })}</span>
              )}
              {!guided && regional.ready && annualSavings > 0 && key === "annual" && (
                <span>{t("Save")}{" "}{annualSavings}{"%"}</span>
              )}
            </button>
          ))}
        </div>
        <small>
          {guided
            ? !regional.ready || weekly.savingsPercent <= 0 || period === "weekly"
              ? t("Choose Monthly or Annual for a lower weekly cost.")
              : t("Save {{saving}}/week ({{percent}}%) vs Weekly · Rounded equivalents, 52 weeks/year.", { saving: weekly.saving, percent: weekly.savingsPercent })
            : t("Annual savings compared with 12 monthly payments.")}
        </small>
      </div>
      <div className="cv-plan-grid">
        <article className="cv-plan cv-plan-free">
          <div className="cv-plan-label">
            <span>{t("01 / GET STARTED")}</span>
            <FileText size={21} />
          </div>
          <h3>{t("3-day free trial")}</h3>
          <p>{t("Try every Pro feature for 3 days.")}</p>
          <div className="cv-price">
            <strong>{regional.prices ? formatMoney(0, regional.prices.currency) : "0"}</strong>
            <span>{"/"}{t("3 days")}</span>
          </div>
          <div className="cv-price-caption">{t("Credit card required to activate.")}</div>
          <StartLink className="cv-button cv-button-outline">
            {t("Start Free Trial")}{" "}<ArrowUpRight size={17} />
          </StartLink>
          <ul>
            {proFeatures.slice(0, 3).map((feature) => (
              <li key={feature}>
                <Check size={16} />
                {t(feature)}
              </li>
            ))}
            <li>
              <Check size={16} />
              {t("PDF & DOCX export")}</li>
          </ul>
          <p className="cv-plan-footnote">
            {t("After 3 days, renews at {{amount}} per week unless cancelled. Complete onboarding, then activate with your card.", { amount: money(weeklyBase) })}</p>
        </article>
        <article className="cv-plan cv-plan-pro">
          <div className="cv-plan-label">
            <span>{t("02 / KEEP THE MOMENTUM")}</span>
            <Sparkles size={21} />
          </div>
          <h3>
            {t("Pro")}{" "}
            <span className="cv-plan-badge">
              {guided && period === "monthly"
                ? t("Monthly · Recommended")
                : t("For an active search")}
            </span>
          </h3>
          <p>
            {guided
              ? t("One subscription. A tailored CV for every opportunity.")
              : t("Room for every role on your shortlist.")}
          </p>
          <div className="cv-price" aria-live="polite">
            <strong>{guided ? weekly.price : price.price}</strong>
            <span>
              {"/"}{guided ? t("week") : price.interval}
              {guided && period !== "weekly" && t(" equivalent")}
            </span>
          </div>
          <div className="cv-price-caption">
            {t("{{amount}} billed {{period}}.", { amount: price.price, period: t(period === "annual" ? "annually" : period) })}
          </div>
          <button className="cv-button" onClick={choosePro} disabled={!regional.ready}>
            {t("Choose Pro")}{" "}{price.label.toLowerCase()} <ArrowUpRight size={17} />
          </button>
          <ul>
            {proFeatures.map((feature, index) => (
              <li key={feature}>
                <Check size={16} />
                {guided ? (
                  <span>
                    <strong>
                      {
                        [
                          t("Unlimited CVs"),
                          t("Unlimited exports"),
                          t("Unlimited AI"),
                          t("Your final say"),
                        ][index]
                      }
                    </strong>{" "}
                    {"·"}{" "}
                    {
                      [
                        t("apply to more roles"),
                        t("PDF & DOCX"),
                        t("keep improving"),
                        t("review every version"),
                      ][index]
                    }
                  </span>
                ) : (
                  feature
                )}
              </li>
            ))}
          </ul>
          <p className="cv-plan-footnote">{t("Create your account, then continue directly to secure checkout. Onboarding follows payment.")}</p>
        </article>
      </div>
      {teaser && (
        <Link
          to={`${guided?.pricingPath ?? `/designs/${concept}/pricing`}?billing=${period}`}
          className="cv-text-link cv-pricing-full-link"
        >
          {t("See the full plan comparison")}{" "}<ArrowRight size={16} />
        </Link>
      )}
    </div>
  );
}

export function PlanComparison() {
  useTranslation();
  const rows = [
    ["Tailored CVs", "Unlimited", "Unlimited"],
    ["PDF & DOCX exports", "Unlimited", "Unlimited"],
    ["AI actions", "Unlimited", "Unlimited"],
    ["Choose relevant keywords", "Included", "Included"],
    ["Review and edit your CV", "Included", "Included"],
    ["Document storage", "Included", "Included"],
  ];
  return (
    <section className="cv-wrap cv-section cv-plan-comparison">
      <div className="cv-section-heading">
        <Eyebrow>{t("THE DETAILS, AT A GLANCE")}</Eyebrow>
        <h2>{t("A little more clarity.")}</h2>
      </div>
      <div className="cv-table-scroll">
        <table>
          <caption className="cv-sr-only">{t("Trial and Pro plan features")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("What’s included")}</th>
              <th scope="col">{t("3-day free trial")}</th>
              <th scope="col">{t("Pro · all billing periods")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, free, pro]) => (
              <tr key={name}>
                <th scope="row">{t(name)}</th>
                <td>{t(free)}</td>
                <td>{t(pro)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cv-table-note">
        {t("Trial and Pro include the same features. Activate the trial with a credit card; it renews weekly unless cancelled before the trial ends.")}</p>
    </section>
  );
}

export function FAQ({ pricing = false }: { pricing?: boolean }) {
  useTranslation();
  const items = [
    [
      "Can I start for free?",
      "Start a 3-day trial with a card. Trial and Pro include the same features.",
    ],
    [
      "Do I need to write a new CV?",
      "Start with the CV you already have. Upload a PDF or DOCX, add the job description, and select the keywords that fit your experience. You can review and edit the tailored version before exporting.",
    ],
    [
      "Will it add skills I don’t have?",
      "You choose relevant keywords and supply the supporting evidence. Review the suggestions and remove anything you cannot stand behind. In our sample, SQL stays out because the applicant has not provided evidence for it.",
    ],
    [
      "What can I download?",
      "Trial and Pro include unlimited PDF and DOCX exports after activation.",
    ],
    ...(pricing
      ? [
          [
            "How does Pro billing work?",
            "Choose weekly, monthly, or annual billing. The price shown is the charge for that full period, and the subscription renews at that interval. You create an account before continuing to checkout. These alternatives select the paid plan directly; a free trial is not included in this selection.",
          ],
          [
            "Where do I manage my subscription?",
            "Open your billing settings in the app to access the billing portal and manage your subscription. Review your next renewal date and any cancellation terms there before confirming changes.",
          ],
        ]
      : []),
  ];
  return (
    <section className="cv-wrap cv-section cv-faq" id="questions">
      <div>
        <Eyebrow>{t("A FEW GOOD QUESTIONS")}</Eyebrow>
        <h2>
          {t("Good to know.")}<br />
          {t("Before you go.")}</h2>
        <p>{t("A clearer picture of your next step.")}</p>
      </div>
      <div className="cv-faq-list">
        {items.map(([question, answer], index) => (
          <details key={question} open={index === 0 ? true : undefined}>
            <summary>
              {question}
              <ChevronDown size={18} />
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function FinalCTA({ concept }: { concept: Concept }) {
  useTranslation();
  return (
    <section className="cv-final-cta cv-wrap">
      <div>
        <Eyebrow>{t("YOUR NEXT MOVE STARTS HERE")}</Eyebrow>
        <h2>
          {concept === "editorial" ? (
            <>
              {t("Make your next")}<br />
              <em>{t("chapter count.")}</em>
            </>
          ) : concept === "studio" ? (
            <>
              {t("One role. One focused CV.")}<br />
              {t("Your next move.")}</>
          ) : (
            <>
              {t("A new opportunity.")}<br />{t("A CV that’s ready for it.")}</>
          )}
        </h2>
      </div>
      <div>
        <StartLink />
        <p>{t("Start a 3-day trial. Card required to activate.")}</p>
      </div>
      <ArrowUpRight className="cv-final-arrow" aria-hidden="true" />
    </section>
  );
}

export function DesignFooter({ concept }: { concept: Concept }) {
  useTranslation();
  return (
    <footer className="cv-footer cv-wrap">
      <div>
        <Link to={`/designs/${concept}`} className="cv-wordmark">
          {"jobspecific"}<span>{t("CV")}</span>
          <span className="cv-brand-dot">{"."}</span>
        </Link>
        <p>{t("Your experience. Clearly relevant.")}</p>
      </div>
      <nav aria-label={t("Footer")}>
        <Link to={`/designs/${concept}/pricing`}>{t("Pricing")}</Link>
        <Link to="/career-advice">{t("Career resources")}</Link>
        <Link to="/signin">{t("Sign in")}</Link>
        <Link to="/designs">
          {t("All design directions")}{" "}<ArrowUpRight size={13} />
        </Link>
      </nav>
      <div className="cv-footer-bottom">
        <span>{"©"}{new Date().getFullYear()} {" "}{t("JobSpecificCV")}</span>
        <span>{t("Made for your next move.")}</span>
      </div>
    </footer>
  );
}

export function TrustLine() {
  useTranslation();
  return (
    <div className="cv-trust-line">
      <span>
        <CheckCheck size={17} /> {" "}{t("Your experience comes first")}</span>
      <span>
        <ShieldCheck size={17} /> {" "}{t("Review every change")}</span>
      <span>
        <FileText size={17} /> {" "}{t("PDF & DOCX exports")}</span>
    </div>
  );
}

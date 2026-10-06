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
  ANNUAL_SAVINGS_PERCENT,
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
      Tailor my CV free <ArrowRight size={17} />
    </>
  ),
  className = "cv-button",
  to = CV_START_PATH,
}: {
  children?: ReactNode;
  className?: string;
  to?: string;
}) {
  return (
    <Link
      to={to}
      state={{ from: "/app/create" }}
      className={className}
      onClick={clearPendingCheckout}
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
  const { search } = useLocation();
  return (
    <div className="cv-review-bar">
      <Link to="/designs" className="cv-review-home">
        <LayoutGrid size={14} />
        <span>Design explorations</span>
      </Link>
      <nav aria-label="Design alternatives">
        {CONCEPTS.filter(
          (item) =>
            isNewConcept(item.id) === (concept ? isNewConcept(concept) : true),
        ).map((item) => (
          <Link
            key={item.id}
            to={`/designs/${item.id}${pricing ? "/pricing" : ""}${pricing ? search : ""}`}
            aria-current={concept === item.id ? "page" : undefined}
          >
            <span>{item.number}</span> {item.label}
          </Link>
        ))}
      </nav>
      <Link to="/" className="cv-current-link">
        Current site <ArrowUpRight size={13} />
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
  const [open, setOpen] = useState(false);
  const base = `/designs/${concept}`;
  return (
    <header className="cv-header cv-wrap">
      <Link to={base} className="cv-wordmark" aria-label="JobSpecificCV home">
        <span className="cv-brand-icon">
          <FileText size={21} />
        </span>
        jobspecific<span>CV</span>
        <span className="cv-brand-dot">.</span>
      </Link>
      <nav
        className={`cv-navigation ${open ? "is-open" : ""}`}
        aria-label="Main navigation"
        id="concept-navigation"
      >
        <Link to={`${base}#how-it-works`} onClick={() => setOpen(false)}>
          How it works
        </Link>
        <Link to={`${base}#example`} onClick={() => setOpen(false)}>
          See the difference
        </Link>
        <Link
          to={`${base}/pricing`}
          aria-current={pricing ? "page" : undefined}
          onClick={() => setOpen(false)}
        >
          Pricing
        </Link>
        <Link to="/career-advice">
          Resources <ArrowUpRight size={12} />
        </Link>
        <Link to="/signin" className="cv-mobile-signin">
          Sign in
        </Link>
      </nav>
      <div className="cv-nav-actions">
        <Link to="/signin" className="cv-signin">
          Sign in
        </Link>
        <StartLink className="cv-button cv-button-small">
          Start free <ArrowUpRight size={15} />
        </StartLink>
      </div>
      <button
        className="cv-menu-toggle"
        aria-controls="concept-navigation"
        aria-expanded={open}
        aria-label={open ? "Close navigation" : "Open navigation"}
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
        Skip to content
      </a>
      <ReviewBar concept={concept} pricing={pricing} />
      <DesignNav concept={concept} pricing={pricing} />
      <main id="concept-main">{children}</main>
      <DesignFooter concept={concept} />
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="cv-eyebrow">{children}</div>;
}

export function ExampleDocument({
  compact = false,
  editorial = false,
}: {
  compact?: boolean;
  editorial?: boolean;
}) {
  return (
    <div
      className={`cv-document ${compact ? "cv-document-compact" : ""} ${editorial ? "cv-document-editorial" : ""}`}
    >
      <div className="cv-document-top">
        <span>CURRICULUM VITAE</span>
        <span>ILLUSTRATIVE SAMPLE</span>
      </div>
      <h3>
        Alex Morgan<span>Data Analyst</span>
      </h3>
      <div className="cv-document-contact">
        London, UK <span>·</span> alex@example.com
      </div>
      <section>
        <h4>Profile</h4>
        <p>
          Turning sales data into clear, useful weekly reports. Experienced in
          Excel reporting and communicating trends.
        </p>
      </section>
      <section>
        <h4>Experience</h4>
        <div className="cv-document-role">
          <strong>Reporting Assistant</strong>
          <span>2023–2025</span>
        </div>
        <p className="cv-document-employer">Example Company · London</p>
        <p className="cv-document-highlight">
          Prepared weekly <mark>Excel reports</mark> to track{" "}
          <mark>sales performance</mark> and highlight trends.
        </p>
        <p>Organized sales records and shared reports with the team.</p>
      </section>
      <section>
        <h4>Skills</h4>
        <p>
          Excel &nbsp; / &nbsp; Sales analysis &nbsp; / &nbsp; Weekly reporting
        </p>
      </section>
      {!compact && (
        <section>
          <h4>Education</h4>
          <strong>BSc Business Management</strong>
          <p>Example University · 2023</p>
        </section>
      )}
      <div className="cv-document-bottom">
        <span>ALEX MORGAN</span>
        <span>01</span>
      </div>
    </div>
  );
}

export function Transformation({ compact = false }: { compact?: boolean }) {
  const [confirmed, setConfirmed] = useState(true);
  return (
    <div
      className={`cv-transformation ${compact ? "cv-transformation-compact" : ""}`}
    >
      <div className="cv-example-heading">
        <span>
          <span className="cv-status-dot" /> Data Analyst application
        </span>
        <span>Illustrative example</span>
      </div>
      <div className="cv-requirements">
        <span>The role asks for</span>
        <div>
          <span>Excel</span>
          <span>Sales analysis</span>
          <span>Weekly reporting</span>
          <span className="cv-unsupported">SQL · needs evidence</span>
        </div>
      </div>
      <div className="cv-sentence-grid">
        <div className="cv-sentence-before">
          <span className="cv-small-label">YOUR ORIGINAL EXPERIENCE</span>
          <p>“{ORIGINAL_SENTENCE}”</p>
          <span className="cv-sentence-note">A good starting point.</span>
        </div>
        <div className="cv-sentence-after">
          <span className="cv-small-label">
            <Sparkles size={13} /> TAILORED TO THE ROLE
          </span>
          <p aria-live="polite">
            “{confirmed ? TAILORED_SENTENCE : NARROW_SENTENCE}”
          </p>
          <span className="cv-sentence-note">
            <Check size={14} /> Your experience, with a clearer focus.
          </span>
        </div>
      </div>
      <label className="cv-evidence-checkbox">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>I tracked performance and identified trends in this role.</span>
      </label>
      <div className="cv-change-explanation">
        <ShieldCheck size={18} />
        <p>
          {confirmed
            ? "Excel, reporting frequency, and purpose are easier to spot. The wording reflects the experience confirmed above."
            : "The wording stays narrower without that confirmation. Only the experience you can support belongs on your CV."}{" "}
          SQL stays out until you add evidence.
        </p>
      </div>
    </div>
  );
}

export function PricingCards({
  concept,
  teaser = false,
  guided,
}: {
  concept: Concept;
  teaser?: boolean;
  guided?: { onTrial: () => void; pricingPath: string };
}) {
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
  const price = BILLING[period];
  const weekly = weeklyPriceComparison(period);
  const monthlySavings = weeklyPriceComparison("monthly").savingsPercent;
  const selectPeriod = (next: CheckoutTarget) => {
    setTeaserPeriod(next);
    if (!teaser)
      setSearchParams(
        { billing: next },
        { replace: true, preventScrollReset: true },
      );
  };
  const choosePro = () => {
    // The paid weekly choice is explicit: do not imply unverified trial terms.
    setPendingCheckout({
      plan_code: period,
      ...(period === "weekly" ? { with_trial: false } : {}),
    });
    navigate(guided ? "/onboarding" : "/signup", { state: { from: "/app/create" } });
  };
  const proFeatures = [
    "Unlimited tailored CVs",
    "Unlimited PDF & DOCX exports",
    "Unlimited AI actions",
    "Review and edit every version",
  ];
  return (
    <div className={`cv-pricing-module ${teaser ? "cv-pricing-teaser" : ""}`}>
      <div className="cv-billing-controls">
        <span>Choose your Pro billing period</span>
        <div
          className="cv-billing-selector"
          role="group"
          aria-label="Pro billing period"
        >
          {(Object.keys(BILLING) as CheckoutTarget[]).map((key) => (
            <button
              key={key}
              onClick={() => selectPeriod(key)}
              aria-pressed={period === key}
            >
              {BILLING[key].label}
              {guided && key === "monthly" && (
                <span>Save {monthlySavings}%</span>
              )}
              {!guided && key === "annual" && (
                <span>Save {ANNUAL_SAVINGS_PERCENT}%</span>
              )}
            </button>
          ))}
        </div>
        <small>
          {guided
            ? period === "weekly"
              ? "Choose Monthly or Annual for a lower weekly cost."
              : `Save ${weekly.saving}/week (${weekly.savingsPercent}%) vs Weekly · Rounded equivalents, 52 weeks/year.`
            : "Annual savings compared with 12 monthly payments."}
        </small>
      </div>
      <div className="cv-plan-grid">
        <article className="cv-plan cv-plan-free">
          <div className="cv-plan-label">
            <span>01 / GET STARTED</span>
            <FileText size={21} />
          </div>
          <h3>Free</h3>
          <p>Find your footing. Make your first moves.</p>
          <div className="cv-price">
            <strong>$0</strong>
            <span>/ {guided ? "week" : "month"}</span>
          </div>
          <div className="cv-price-caption">No card required.</div>
          <StartLink className="cv-button cv-button-outline">
            Start with Free <ArrowUpRight size={17} />
          </StartLink>
          <ul>
            {PLAN_CARDS[0].features.slice(0, 3).map((feature) => (
              <li key={feature}>
                <Check size={16} />
                {feature}
              </li>
            ))}
            <li>
              <Check size={16} />
              PDF & DOCX export
            </li>
          </ul>
          <p className="cv-plan-footnote">
            Monthly limits apply separately to CVs, exports, and AI actions.
          </p>
        </article>
        <article className="cv-plan cv-plan-pro">
          <div className="cv-plan-label">
            <span>02 / KEEP THE MOMENTUM</span>
            <Sparkles size={21} />
          </div>
          <h3>
            Pro{" "}
            <span className="cv-plan-badge">
              {guided && period === "monthly"
                ? "Monthly · Recommended"
                : "For an active search"}
            </span>
          </h3>
          <p>
            {guided
              ? "One subscription. A tailored CV for every opportunity."
              : "Room for every role on your shortlist."}
          </p>
          <div className="cv-price" aria-live="polite">
            <strong>{guided ? weekly.price : price.price}</strong>
            <span>
              / {guided ? "week" : price.interval}
              {guided && period !== "weekly" && " equivalent"}
            </span>
          </div>
          <div className="cv-price-caption">
            {price.price} billed {period === "annual" ? "annually" : period}.{" "}
            {price.renewal}.
          </div>
          <button className="cv-button" onClick={choosePro}>
            Choose Pro {price.label.toLowerCase()} <ArrowUpRight size={17} />
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
                          "Unlimited CVs",
                          "Unlimited exports",
                          "Unlimited AI",
                          "Your final say",
                        ][index]
                      }
                    </strong>{" "}
                    ·{" "}
                    {
                      [
                        "apply to more roles",
                        "PDF & DOCX",
                        "keep improving",
                        "review every version",
                      ][index]
                    }
                  </span>
                ) : (
                  feature
                )}
              </li>
            ))}
          </ul>
          <p className="cv-plan-footnote">
            {guided ? (
              <>
                <button
                  type="button"
                  className="gj-trial-link"
                  onClick={guided.onTrial}
                >
                  Or try Pro free for 3 days <ArrowRight size={12} />
                </button>
                <br />
                Eligible new subscribers · Weekly plan · Then{" "}
                {BILLING.weekly.price}/week.
              </>
            ) : (
              <>
                Create your account, then confirm your plan at checkout.
                {period === "weekly"
                  ? " This selects the paid weekly plan without a trial."
                  : ""}
              </>
            )}
          </p>
        </article>
      </div>
      {teaser && (
        <Link
          to={`${guided?.pricingPath ?? `/designs/${concept}/pricing`}?billing=${period}`}
          className="cv-text-link cv-pricing-full-link"
        >
          See the full plan comparison <ArrowRight size={16} />
        </Link>
      )}
    </div>
  );
}

export function PlanComparison() {
  const rows = [
    ["Tailored CVs", "3 / month", "Unlimited"],
    ["PDF & DOCX exports", "5 / month", "Unlimited"],
    ["AI actions", "20 / month", "Unlimited"],
    ["Choose relevant keywords", "Included", "Included"],
    ["Review and edit your CV", "Included", "Included"],
    ["Document storage", "25 MB", "Unlimited"],
  ];
  return (
    <section className="cv-wrap cv-section cv-plan-comparison">
      <div className="cv-section-heading">
        <Eyebrow>THE DETAILS, AT A GLANCE</Eyebrow>
        <h2>A little more clarity.</h2>
      </div>
      <div className="cv-table-scroll">
        <table>
          <caption className="cv-sr-only">Free and Pro plan features</caption>
          <thead>
            <tr>
              <th scope="col">What’s included</th>
              <th scope="col">Free</th>
              <th scope="col">Pro · all billing periods</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, free, pro]) => (
              <tr key={name}>
                <th scope="row">{name}</th>
                <td>{free}</td>
                <td>{pro}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="cv-table-note">
        An AI action is a request to an AI feature, such as a rewrite or
        suggestion. Tailoring may also use AI actions; free limits are separate
        allowances.
      </p>
    </section>
  );
}

export function FAQ({ pricing = false }: { pricing?: boolean }) {
  const items = [
    [
      "Can I start for free?",
      "Yes. The Free plan requires no card and includes 3 customized CVs, 5 exports, and 20 AI actions each month. These are separate limits, so a tailoring workflow may use both a CV generation and AI actions.",
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
      "You can export your CV as PDF or DOCX. The Free plan includes 5 exports per month; Pro includes unlimited exports.",
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
        <Eyebrow>A FEW GOOD QUESTIONS</Eyebrow>
        <h2>
          Good to know.
          <br />
          Before you go.
        </h2>
        <p>A clearer picture of your next step.</p>
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
  return (
    <section className="cv-final-cta cv-wrap">
      <div>
        <Eyebrow>YOUR NEXT MOVE STARTS HERE</Eyebrow>
        <h2>
          {concept === "editorial" ? (
            <>
              Make your next
              <br />
              <em>chapter count.</em>
            </>
          ) : concept === "studio" ? (
            <>
              One role. One focused CV.
              <br />
              Your next move.
            </>
          ) : (
            <>
              A new opportunity.
              <br />A CV that’s ready for it.
            </>
          )}
        </h2>
      </div>
      <div>
        <StartLink />
        <p>Start free. No card required.</p>
      </div>
      <ArrowUpRight className="cv-final-arrow" aria-hidden="true" />
    </section>
  );
}

export function DesignFooter({ concept }: { concept: Concept }) {
  return (
    <footer className="cv-footer cv-wrap">
      <div>
        <Link to={`/designs/${concept}`} className="cv-wordmark">
          jobspecific<span>CV</span>
          <span className="cv-brand-dot">.</span>
        </Link>
        <p>Your experience. Clearly relevant.</p>
      </div>
      <nav aria-label="Footer">
        <Link to={`/designs/${concept}/pricing`}>Pricing</Link>
        <Link to="/career-advice">Career resources</Link>
        <Link to="/signin">Sign in</Link>
        <Link to="/designs">
          All design directions <ArrowUpRight size={13} />
        </Link>
      </nav>
      <div className="cv-footer-bottom">
        <span>© {new Date().getFullYear()} JobSpecificCV</span>
        <span>Made for your next move.</span>
      </div>
    </footer>
  );
}

export function TrustLine() {
  return (
    <div className="cv-trust-line">
      <span>
        <CheckCheck size={17} /> Your experience comes first
      </span>
      <span>
        <ShieldCheck size={17} /> Review every change
      </span>
      <span>
        <FileText size={17} /> PDF & DOCX exports
      </span>
    </div>
  );
}

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  FileText,
  LayoutGrid,
  Menu,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import {
  Eyebrow,
  PlanComparison,
  PricingCards,
  StartLink,
  TrustLine,
} from "./DesignShared";
import { DemoDialog, ProductDemo, type DemoAction } from "./ProductDemo";
import { MascotRail } from "./MascotRail";
import { scrollToJourneySection } from "./mascot-navigation";
import { setPendingCheckout } from "../../integration/pending-checkout";
import { BILLING } from "./concepts";
import {
  DEFAULT_MASCOT_CONFIG,
  type MascotConfig,
  type MessageId,
} from "./mascot-config";
import { GUIDED_JOURNEY_FAQ_ITEMS } from "../../../content/seo-meta.mjs";
import { TemplateShowcase } from "./TemplateShowcase";
import "./round-two.css";
import "./guided-journey.css";

export default function GuidedJourney({
  pricing = false,
  basePath: BASE = "/designs/guided-journey",
  review = true,
  settings,
  templateSection,
  templateOverlayOpen = false,
}: {
  pricing?: boolean;
  basePath?: string;
  review?: boolean;
  templateSection?: ReactNode;
  templateOverlayOpen?: boolean;
  settings?: {
    config: MascotConfig;
    pinned: MessageId | null;
    inspect: boolean;
  };
}) {
  const mascotConfig = settings?.config ?? DEFAULT_MASCOT_CONFIG;
  const pinned = settings?.pinned ?? null;
  const inspect = settings?.inspect ?? false;
  const [menu, setMenu] = useState(false);
  const [trial, setTrial] = useState(false);
  const [demoModal, setDemoModal] = useState(false);
  const [templateModal, setTemplateModal] = useState(false);
  const [demoStep, setDemoStep] = useState(1);
  const [reaction, setReaction] = useState<DemoAction | null>(null);
  const [helpRequest, setHelpRequest] = useState(0);
  const reacted = useRef(new Map<DemoAction, number>());
  const editTimer = useRef<ReturnType<typeof setTimeout>>();
  const { pathname, hash } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (hash) scrollToJourneySection(hash.slice(1), "instant");
      else window.scrollTo(0, 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [pathname, hash]);
  useEffect(() => {
    if (!menu) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu]);
  useEffect(() => {
    if (!reaction) return;
    const timer = window.setTimeout(
      () => setReaction(null),
      mascotConfig.motion.reactionMs,
    );
    return () => window.clearTimeout(timer);
  }, [reaction, mascotConfig.motion.reactionMs]);
  useEffect(() => () => clearTimeout(editTimer.current), []);
  const onAction = useCallback(
    (action: DemoAction) => {
      if (action === "reset") {
        clearTimeout(editTimer.current);
        reacted.current.clear();
        setReaction(null);
        return;
      }
      const previous = reacted.current.get(action);
      if (
        previous !== undefined &&
        (!mascotConfig.motion.repeatReactions ||
          Date.now() - previous <
            Math.max(
              mascotConfig.motion.cooldownMs,
              mascotConfig.motion.reactionMs + 100,
            ))
      )
        return;
      const acknowledge = () => {
        reacted.current.set(action, Date.now());
        setReaction(action);
      };
      if (action === "edit") {
        clearTimeout(editTimer.current);
        editTimer.current = setTimeout(
          acknowledge,
          mascotConfig.motion.editDelay,
        );
      } else acknowledge();
    },
    [mascotConfig.motion],
  );
  const jumpTo = scrollToJourneySection;
  const beginTrial = () => {
    setPendingCheckout({ plan_code: "weekly", with_trial: true });
    navigate("/signup", { state: { from: "/app/create" } });
  };
  return (
    <div
      className="cv-concept cv-journey cv-guided-journey"
      data-mascot-inspect={inspect}
    >
      <a href="#gj-main" className="cv-skip-link">
        Skip to content
      </a>
      {review && (
        <div className="cv-review-bar">
          <Link to="/designs" className="cv-review-home">
            <LayoutGrid size={14} />
            <span>Design explorations</span>
          </Link>
          <nav aria-label="Compare directions">
            <Link
              to={`${BASE}${pricing ? "/pricing" : ""}`}
              aria-current="page"
            >
              Combined
            </Link>
            <Link to={`/designs/journey${pricing ? "/pricing" : ""}`}>
              Journey
            </Link>
            <Link to={`/designs/companion${pricing ? "/pricing" : ""}`}>
              Companion
            </Link>
          </nav>
          <Link to={`${BASE}/editor`} className="cv-current-link">
            Tune companion <ArrowUpRight size={13} />
          </Link>
        </div>
      )}
      <header className="cv-header cv-wrap">
        <Link to={BASE} className="cv-wordmark">
          <span className="cv-brand-icon">
            <FileText size={21} />
          </span>
          jobspecific<span>CV</span>
          <span className="cv-brand-dot">.</span>
        </Link>
        <nav
          id="gj-navigation"
          className={`cv-navigation ${menu ? "is-open" : ""}`}
          aria-label="Main navigation"
        >
          <Link onClick={() => setMenu(false)} to={`${BASE}#demo`}>
            Try the demo
          </Link>
          <Link onClick={() => setMenu(false)} to={`${BASE}#templates`}>
            Templates
          </Link>
          <Link
            onClick={() => setMenu(false)}
            to={`${BASE}/pricing`}
            aria-current={pricing ? "page" : undefined}
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
        <div className="cv-nav-actions" id="gj-header-actions">
          <Link to="/signin" className="cv-signin">
            Sign in
          </Link>
          <StartLink className="cv-button cv-button-small">
            Start free <ArrowUpRight size={15} />
          </StartLink>
        </div>
        <button
          className="cv-menu-toggle"
          aria-controls="gj-navigation"
          aria-expanded={menu}
          aria-label={menu ? "Close navigation" : "Open navigation"}
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X /> : <Menu />}
        </button>
      </header>
      <main id="gj-main">
        {!pricing ? (
          <>
            <section className="cv-wrap gj-centered-hero" id="gj-hero">
              <div className="gj-centered-copy">
                <Eyebrow>
                  <span className="cv-status-dot" />A LITTLE GUIDANCE. A
                  BETTER-FITTING CV.
                </Eyebrow>
                <h1>
                  Tailor your CV to any
                  <br className="gj-wide-break" /> job description.{" "}
                  <em>In minutes.</em>
                </h1>
                <p>
                  Upload your CV, paste a job description, and get a cleaner,
                  ATS-friendly version focused on the role in front of you.
                </p>
                <div className="cv-hero-actions">
                  <StartLink>
                    Tailor your CV — it’s free <ArrowRight size={17} />
                  </StartLink>
                  <button
                    className="cv-text-link gj-plain-button"
                    onClick={() => jumpTo("demo")}
                  >
                    Try it first <ArrowDown size={16} />
                  </button>
                </div>
                <div className="cv-free-note">
                  <Check size={13} />
                  Free to start · No credit card required
                </div>
              </div>
            </section>
            <section className="gj-demo-section" id="demo">
              <div className="cv-wrap">
                <div className="gj-section-title">
                  <div>
                    <Eyebrow>TAKE IT FOR A SPIN</Eyebrow>
                    <h2>Meet your new CV workspace.</h2>
                  </div>
                  <span>Click, edit, and explore.</span>
                </div>
                <div className="gj-demo-track">
                  <div className="cv-round-two gj-demo-surface">
                    <ProductDemo
                      onStepChange={setDemoStep}
                      onAction={onAction}
                      onExplorePlans={() => jumpTo("plans")}
                      onModalChange={setDemoModal}
                      hideCompanionCaption
                    />
                  </div>
                </div>
                <p className="gj-demo-caption">
                  A fictional CV. A real feel for the product.
                </p>
              </div>
            </section>
            <div className="cv-wrap">
              <TrustLine />
            </div>
            <section className="cv-wrap gj-reassurance">
              <div>
                <ShieldCheck size={22} />
                <h3>You have the final say.</h3>
                <p>Every suggestion is yours to review.</p>
              </div>
              <div>
                <Sparkles size={22} />
                <h3>Built around the role.</h3>
                <p>Your experience, with a clearer focus.</p>
              </div>
              <div>
                <FileText size={22} />
                <h3>Ready for the next step.</h3>
                <p>Polished PDF and editable DOCX exports.</p>
              </div>
            </section>
            {templateSection ?? (
              <TemplateShowcase
                direction="lookbook"
                onOverlayChange={setTemplateModal}
              />
            )}
          </>
        ) : (
          <section
            className="cv-wrap cv-pricing-page-hero gj-pricing-intro"
            id="gj-hero"
          >
            <Link className="cv-back-link" to={BASE}>
              ← Back to the story
            </Link>
            <div className="cv-section-heading">
              <Eyebrow>A PLAN FOR WHEREVER YOU ARE IN YOUR SEARCH</Eyebrow>
              <h1>
                Your next step.
                <br />
                <span>At your own pace.</span>
              </h1>
              <p>Start free. Make room for every opportunity with Pro.</p>
            </div>
          </section>
        )}
        <section
          className={`cv-wrap ${pricing ? "gj-pricing-plans" : "cv-section"}`}
          id="plans"
        >
          {!pricing && (
            <div className="cv-section-heading">
              <Eyebrow>SPACE TO START. ROOM TO GROW.</Eyebrow>
              <h2>Your search. Your pace.</h2>
              <p>
                A tailored CV for every role. One subscription to keep you
                moving.
              </p>
            </div>
          )}
          {pricing && (
            <button
              className="gj-pricing-help gj-inline-button"
              onClick={() => setHelpRequest((value) => value + 1)}
            >
              <img src="/images/logo.png" width="25" height="25" alt="" />
              Let me help you choose <ArrowRight size={14} />
            </button>
          )}
          <PricingCards
            concept="journey"
            teaser={!pricing}
            guided={{
              onTrial: () => setTrial(true),
              pricingPath: `${BASE}/pricing`,
            }}
          />
        </section>
        {pricing && (
          <details className="gj-comparison cv-wrap">
            <summary>
              Compare all the details <ChevronDown size={18} />
            </summary>
            <PlanComparison />
          </details>
        )}
        <section className="cv-wrap gj-signup" id="get-started">
          <div className="gj-signup-art">
            <img
              src="/images/cover-before-after.webp"
              width="1672"
              height="941"
              alt="Your mascot guide presenting a polished CV"
              loading="lazy"
            />
          </div>
          <div>
            <Eyebrow>YOUR NEXT MOVE STARTS HERE</Eyebrow>
            <h2>
              A new opportunity.
              <br />
              <span>A CV that’s ready for it.</span>
            </h2>
            <p>Bring your experience. We’ll help you put it to work.</p>
            <StartLink>
              Let’s tailor my CV <ArrowRight size={17} />
            </StartLink>
            <small>Free to start. No card required.</small>
          </div>
        </section>
        <section className="cv-wrap gj-faq">
          <h2>A few quick answers.</h2>
          <div>
            {GUIDED_JOURNEY_FAQ_ITEMS.map(({ question: q, answer: a }) => (
              <details key={q}>
                <summary>
                  {q}
                  <ChevronDown size={16} />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className="cv-footer cv-wrap">
        <div>
          <Link to={BASE} className="cv-wordmark">
            jobspecific<span>CV</span>.
          </Link>
          <p>Your experience. Clearly relevant.</p>
        </div>
        <nav aria-label="Footer">
          <Link to={`${BASE}/pricing`}>Pricing</Link>
          <Link to="/career-advice">Career resources</Link>
          {review && (
            <Link to="/designs">
              All design directions <ArrowUpRight size={13} />
            </Link>
          )}
          <button
            className="gj-inline-button"
            onClick={() => {
              setHelpRequest((value) => value + 1);
              jumpTo(pricing ? "plans" : "demo");
            }}
          >
            <RotateCcw size={13} />
            Meet your guide
          </button>
        </nav>
        <div className="cv-footer-bottom">
          <span>© {new Date().getFullYear()} JobSpecificCV</span>
          <span>A little help for your next big step.</span>
        </div>
      </footer>

      <MascotRail
        config={mascotConfig}
        pinned={pinned}
        inspect={inspect}
        pricing={pricing}
        demoStep={demoStep}
        reaction={reaction}
        suspended={
          trial || demoModal || templateModal || menu || templateOverlayOpen
        }
        openRequest={helpRequest}
        onTrial={() => setTrial(true)}
      />
      {trial && (
        <div className="cv-round-two">
          <DemoDialog
            title="Try Pro for 3 days"
            onClose={() => setTrial(false)}
          >
            <div className="gj-trial-intro">
              <img
                src="/images/designs/mascot/guide.webp"
                width="70"
                height="105"
                alt=""
              />
              <p>
                A little time to try it all.
                <br />
                <strong>Unlimited tailoring, AI actions, and exports.</strong>
              </p>
            </div>
            <div className="gj-trial-terms">
              <div>
                <span>First 3 days</span>
                <strong>$0</strong>
              </div>
              <div>
                <span>Then Weekly Pro</span>
                <strong>{BILLING.weekly.price} / week</strong>
              </div>
              <p>
                For eligible new subscribers. Card required. Renews weekly
                unless cancelled before the trial ends. Eligibility and final
                terms are confirmed at checkout.
              </p>
            </div>
            <button className="pd-primary" onClick={beginTrial}>
              Create account & try Weekly Pro <ArrowRight size={15} />
            </button>
            <StartLink className="gj-dialog-link">
              Prefer Free? No card required <ArrowRight size={14} />
            </StartLink>
          </DemoDialog>
        </div>
      )}
    </div>
  );
}

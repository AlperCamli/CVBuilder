import { translate as t } from "../../localization/i18n";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "../../localization/LanguageControls";
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
  Languages,
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
import { ProductDemo, type DemoAction } from "./ProductDemo";
import { MascotRail } from "./MascotRail";
import { scrollToJourneySection } from "./mascot-navigation";
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
  useTranslation();
  const mascotConfig = settings?.config ?? DEFAULT_MASCOT_CONFIG;
  const pinned = settings?.pinned ?? null;
  const inspect = settings?.inspect ?? false;
  const [languageDialog, setLanguageDialog] = useState(false);
  useEffect(() => { setLanguageDialog(Boolean(document.querySelector('dialog[open][aria-labelledby="language-choice-title"]'))); const update = (event: Event) => setLanguageDialog(Boolean((event as CustomEvent).detail)); window.addEventListener("cv-language-dialog", update); return () => window.removeEventListener("cv-language-dialog", update); }, []);
  const [menu, setMenu] = useState(false);
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
  return (
    <div
      className="cv-concept cv-journey cv-guided-journey"
      data-mascot-inspect={inspect}
    >
      <a href="#gj-main" className="cv-skip-link">
        {t("Skip to content")}</a>
      {review && (
        <div className="cv-review-bar">
          <Link to="/designs" className="cv-review-home">
            <LayoutGrid size={14} />
            <span>{t("Design explorations")}</span>
          </Link>
          <nav aria-label={t("Compare directions")}>
            <Link
              to={`${BASE}${pricing ? "/pricing" : ""}`}
              aria-current="page"
            >
              {t("Combined")}</Link>
            <Link to={`/designs/journey${pricing ? "/pricing" : ""}`}>
              {t("Journey")}</Link>
            <Link to={`/designs/companion${pricing ? "/pricing" : ""}`}>
              {t("Companion")}</Link>
          </nav>
          <Link to="/designs/guided-journey/languages" className="cv-current-link">Language Studio <Languages size={13} /></Link>
          <Link to={`${BASE}/editor`} className="cv-current-link">
            {t("Tune companion")}{" "}<ArrowUpRight size={13} />
          </Link>
        </div>
      )}
      <header className="cv-header cv-wrap">
        <Link to={BASE || "/"} className="cv-wordmark">
          <span className="cv-brand-icon">
            <img src="/images/logo.png" width={32} height={32} alt="" />
          </span>
          {"jobspecific"}<span>{t("CV")}</span>
          <span className="cv-brand-dot">{"."}</span>
        </Link>
        <nav
          id="gj-navigation"
          className={`cv-navigation ${menu ? "is-open" : ""}`}
          aria-label={t("Main navigation")}
        >
          <Link onClick={() => setMenu(false)} to={`${BASE || "/"}#demo`}>
            {t("Try the demo")}</Link>
          <Link onClick={() => setMenu(false)} to={`${BASE || "/"}#templates`}>
            {t("Templates")}</Link>
          <Link
            onClick={() => setMenu(false)}
            to={`${BASE}/pricing`}
            aria-current={pricing ? "page" : undefined}
          >
            {t("Pricing")}</Link>
          <Link to="/career-advice">
            {t("Resources")}{" "}<ArrowUpRight size={12} />
          </Link>
          <Link to="/signin" className="cv-mobile-signin">
            {t("Sign in")}</Link>
        </nav>
        <div className="cv-nav-actions" id="gj-header-actions">
          <LanguageSwitcher />
          <Link to="/signin" className="cv-signin">
            {t("Sign in")}</Link>
          <StartLink to="/onboarding" className="cv-button cv-button-small">
            {t("Start Free Trial")}{" "}<ArrowUpRight size={15} />
          </StartLink>
        </div>
        <button
          className="cv-menu-toggle"
          aria-controls="gj-navigation"
          aria-expanded={menu}
          aria-label={menu ? t("Close navigation") : t("Open navigation")}
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
                  <span className="cv-status-dot" />{t("A LITTLE GUIDANCE. A BETTER-FITTING CV.")}</Eyebrow>
                <h1>
                  {t("Tailor your CV to any")}<br className="gj-wide-break" /> {" "}{t("job description.")}{" "}
                  <em>{t("In minutes.")}</em>
                </h1>
                <p>
                  {t("Upload your CV, paste a job description, and get a cleaner, ATS-friendly version focused on the role in front of you.")}</p>
                <div className="cv-hero-actions">
                  <StartLink to="/onboarding">
                    {t("Start Free Trial")}{" "}<ArrowRight size={17} />
                  </StartLink>
                  <button
                    className="cv-text-link gj-plain-button"
                    onClick={() => jumpTo("demo")}
                  >
                    {t("Try it first")}{" "}<ArrowDown size={16} />
                  </button>
                </div>
                <div className="cv-free-note">
                  <Check size={13} />
                  {t("3-day free trial · Card required to activate")}</div>
              </div>
            </section>
            <section className="gj-demo-section" id="demo">
              <div className="cv-wrap">
                <div className="gj-section-title">
                  <div>
                    <Eyebrow>{t("TAKE IT FOR A SPIN")}</Eyebrow>
                    <h2>{t("Meet your new CV workspace.")}</h2>
                  </div>
                  <span>{t("Click, edit, and explore.")}</span>
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
                  {t("A fictional CV. A real feel for the product.")}</p>
              </div>
            </section>
            <div className="cv-wrap">
              <TrustLine />
            </div>
            <section className="cv-wrap gj-reassurance">
              <div>
                <ShieldCheck size={22} />
                <h3>{t("You have the final say.")}</h3>
                <p>{t("Every suggestion is yours to review.")}</p>
              </div>
              <div>
                <Sparkles size={22} />
                <h3>{t("Built around the role.")}</h3>
                <p>{t("Your experience, with a clearer focus.")}</p>
              </div>
              <div>
                <FileText size={22} />
                <h3>{t("Ready for the next step.")}</h3>
                <p>{t("Polished PDF and editable DOCX exports.")}</p>
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
            <Link className="cv-back-link" to={BASE || "/"}>
              {t("← Back to the story")}</Link>
            <div className="cv-section-heading">
              <Eyebrow>{t("A PLAN FOR WHEREVER YOU ARE IN YOUR SEARCH")}</Eyebrow>
              <h1>
                {t("Your next step.")}<br />
                <span>{t("At your own pace.")}</span>
              </h1>
              <p>{t("Try Pro for 3 days. Make room for every opportunity.")}</p>
            </div>
          </section>
        )}
        <section
          className={`cv-wrap ${pricing ? "gj-pricing-plans" : "cv-section"}`}
          id="plans"
        >
          {!pricing && (
            <div className="cv-section-heading">
              <Eyebrow>{t("SPACE TO START. ROOM TO GROW.")}</Eyebrow>
              <h2>{t("Your search. Your pace.")}</h2>
              <p>
                {t("A tailored CV for every role. One subscription to keep you moving.")}</p>
            </div>
          )}
          <PricingCards
            concept="journey"
            teaser={!pricing}
            guided={{
              pricingPath: `${BASE}/pricing`,
            }}
          />
        </section>
        {pricing && (
          <details className="gj-comparison cv-wrap">
            <summary>
              {t("Compare all the details")}{" "}<ChevronDown size={18} />
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
              alt={t("Your mascot guide presenting a polished CV")}
              loading="lazy"
            />
          </div>
          <div>
            <Eyebrow>{t("YOUR NEXT MOVE STARTS HERE")}</Eyebrow>
            <h2>
              {t("A new opportunity.")}<br />
              <span>{t("A CV that’s ready for it.")}</span>
            </h2>
            <p>{t("Bring your experience. We’ll help you put it to work.")}</p>
            <StartLink to="/onboarding">
              {t("Let’s tailor my CV")}{" "}<ArrowRight size={17} />
            </StartLink>
            <small>{t("3-day free trial. Card required to activate.")}</small>
          </div>
        </section>
        <section className="cv-wrap gj-faq">
          <h2>{t("A few quick answers.")}</h2>
          <div>
            {GUIDED_JOURNEY_FAQ_ITEMS.map(({ question: q, answer: a }) => (
              <details key={q}>
                <summary>
                  {t(q)}
                  <ChevronDown size={16} />
                </summary>
                <p>{t(a)}</p>
              </details>
            ))}
          </div>
        </section>
      </main>
      <footer className="cv-footer cv-wrap">
        <div>
          <Link to={BASE || "/"} className="cv-wordmark">
            <span className="cv-brand-icon">
              <img src="/images/logo.png" width={32} height={32} alt="" />
            </span>
            {"jobspecific"}<span>{t("CV")}</span>{"."}</Link>
          <p>{t("Your experience. Clearly relevant.")}</p>
        </div>
        <nav aria-label={t("Footer")}>
          <Link to={`${BASE}/pricing`}>{t("Pricing")}</Link>
          <Link to="/career-advice">{t("Career resources")}</Link>
          <Link to={BASE === "/tr" ? "/tr/support" : "/support"}>{t("Support")}</Link>
          {review && (
            <Link to="/designs">
              {t("All design directions")}{" "}<ArrowUpRight size={13} />
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
            {t("Meet your guide")}</button>
        </nav>
        <div className="cv-footer-bottom">
          <span>{"©"}{new Date().getFullYear()} {" "}{t("JobSpecificCV")}</span>
          <span>{t("A little help for your next big step.")}</span>
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
          languageDialog ||
          demoModal || templateModal || menu || templateOverlayOpen
        }
        openRequest={helpRequest}
        onTrial={() => navigate("/onboarding")}
      />

    </div>
  );
}

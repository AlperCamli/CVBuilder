import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Download,
  Menu,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { ReviewBar, StartLink } from "./DesignShared";
import { ProductDemo, Mascot } from "./ProductDemo";
import { SubscriptionOffer } from "./SubscriptionOffer";
import type { NewConcept } from "./concepts";
import "./round-two.css";

function Brand({ concept }: { concept: NewConcept }) {
  return (
    <Link to={`/designs/${concept}`} className="v2-brand">
      <img src="/images/logo.png" alt="" width="30" height="30" />
      jobspecific<span>CV</span>
    </Link>
  );
}

function NewShell({
  concept,
  pricing = false,
  children,
}: {
  concept: NewConcept;
  pricing?: boolean;
  children: ReactNode;
}) {
  const [menu, setMenu] = useState(false);
  const { pathname, hash } = useLocation();
  const base = `/designs/${concept}`;
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
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
  return (
    <div className={`cv-concept cv-round-two cv-${concept}`}>
      <a className="cv-skip-link" href="#new-design-main">
        Skip to content
      </a>
      <ReviewBar concept={concept} pricing={pricing} />
      <header className="v2-nav v2-wrap">
        <Brand concept={concept} />
        <nav
          className={menu ? "is-open" : ""}
          id="v2-navigation"
          aria-label="Main navigation"
        >
          <Link to={`${base}#demo`} onClick={() => setMenu(false)}>
            Try the product
          </Link>
          <Link
            to={`${base}/pricing`}
            aria-current={pricing ? "page" : undefined}
          >
            Pricing
          </Link>
          <Link to="/career-advice">Resources</Link>
          <Link to="/signin" className="v2-mobile-signin">
            Sign in
          </Link>
        </nav>
        <div className="v2-nav-actions">
          <Link to="/signin">Sign in</Link>
          <StartLink className="v2-button v2-button-small">
            Get started free <ArrowUpRight size={14} />
          </StartLink>
        </div>
        <button
          className="v2-menu"
          aria-label={menu ? "Close navigation" : "Open navigation"}
          aria-expanded={menu}
          aria-controls="v2-navigation"
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X size={20} /> : <Menu size={20} />}
        </button>
      </header>
      <main id="new-design-main">{children}</main>
      <footer className="v2-footer v2-wrap">
        <Brand concept={concept} />
        <p>Your experience. Your next opportunity.</p>
        <nav aria-label="Footer">
          <Link to={`${base}/pricing`}>Pricing</Link>
          <Link to="/career-advice">Resources</Link>
          <Link to="/designs">
            All six designs <ArrowUpRight size={13} />
          </Link>
        </nav>
        <span>© {new Date().getFullYear()} JobSpecificCV</span>
      </footer>
    </div>
  );
}

function Hero({ concept }: { concept: NewConcept }) {
  const copy = (
    <>
      <span className="v2-overline">
        <span className="v2-green-dot" />A LITTLE GUIDANCE. A BETTER-FITTING CV.
      </span>
      <h1>
        {concept === "companion" ? (
          <>
            Tailor your CV to any
            <br className="v2-wide-break" /> job description.{" "}
            <em>In minutes.</em>
          </>
        ) : concept === "canvas" ? (
          <>
            Your CV.
            <br />
            <em>
              Tailored to
              <br />
              the job.
            </em>
          </>
        ) : (
          <>
            Your next role.
            <br />
            <em>
              Your CV,
              <br />
              ready for it.
            </em>
          </>
        )}
      </h1>
      <p>
        Upload your CV, paste a job description, and get a cleaner, ATS-friendly
        version focused on the role in front of you.
      </p>
      <div className="v2-hero-actions">
        <StartLink className="v2-button">
          Tailor your CV — it’s free <ArrowRight size={17} />
        </StartLink>
        <a href="#demo" className="v2-quiet-link">
          Try it first <ArrowDown size={16} />
        </a>
      </div>
      <div className="v2-free-note">
        <Check size={13} />
        Free to start · No credit card required
      </div>
    </>
  );
  if (concept === "companion")
    return (
      <section className="v2-wrap v2-hero v2-companion-hero">
        <div className="v2-hero-copy">{copy}</div>
        <div className="v2-companion-mascot">
          <div className="v2-speech">I’ll show you around.</div>
          <Mascot eager />
        </div>
        <span className="v2-hero-doodle" aria-hidden="true">
          ✳
        </span>
      </section>
    );
  if (concept === "canvas")
    return (
      <section className="v2-wrap v2-hero v2-canvas-hero">
        <div className="v2-hero-copy">{copy}</div>
        <div className="v2-canvas-art">
          <div className="v2-art-circle" />
          <div className="v2-speech">
            Let’s make your
            <br />
            experience shine.
          </div>
          <Mascot eager />
          <div className="v2-art-job">
            <span>THE ROLE YOU WANT</span>
            <strong>Data Analyst</strong>
            <p>Excel · Reporting · Sales analysis</p>
            <Check size={19} />
          </div>
          <span className="v2-art-star" aria-hidden="true">
            ✳
          </span>
        </div>
      </section>
    );
  return (
    <section className="v2-wrap v2-hero v2-momentum-hero">
      <div className="v2-hero-copy">{copy}</div>
      <div className="v2-momentum-art">
        <span className="v2-orbit v2-orbit-one" />
        <span className="v2-orbit v2-orbit-two" />
        <div className="v2-speech">
          Your experience.
          <br />
          Your final say.
        </div>
        <Mascot eager />
        <div className="v2-momentum-note">
          <Check size={16} />A little help for your next big step.
        </div>
      </div>
    </section>
  );
}

function Benefits() {
  return (
    <div className="v2-benefits v2-wrap">
      {[
        {
          icon: Sparkles,
          title: "Focused on the role.",
          text: "The employer’s language. Your real experience.",
        },
        {
          icon: ShieldCheck,
          title: "You have the final say.",
          text: "Review every AI change before applying.",
        },
        {
          icon: Download,
          title: "Ready when you are.",
          text: "Export a polished CV as PDF or DOCX.",
        },
      ].map(({ icon: Icon, title, text }) => (
        <div key={title}>
          <Icon size={22} strokeWidth={1.5} />
          <div>
            <h3>{title}</h3>
            <p>{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ShortFAQ({ pricing = false }: { pricing?: boolean }) {
  const items = [
    [
      "Can I start for free?",
      "Yes. No card required. You get 3 tailored CVs, 5 exports, and 20 AI actions per month. Each allowance has its own limit.",
    ],
    [
      "Will it stay true to my experience?",
      "You select the relevant keywords and answer follow-up questions. Review every suggested change before applying it to your CV.",
    ],
    [
      pricing
        ? "How does the subscription work?"
        : "Can I edit and download my CV?",
      pricing
        ? "Choose weekly, monthly, or annual billing. Your plan renews at that interval, with the full charge shown above. Manage your subscription in the app’s billing settings. The weekly option here selects the paid plan without a trial."
        : "Yes. Edit the content, choose your template, and adjust the layout. Export the finished CV as a PDF or an editable DOCX.",
    ],
  ];
  return (
    <section className="v2-faq v2-wrap">
      <h2>A few quick answers.</h2>
      <div>
        {items.map(([question, answer]) => (
          <details key={question}>
            <summary>
              {question}
              <ChevronDown size={16} />
            </summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="v2-closing v2-wrap">
      <div>
        <h2>Your next application starts here.</h2>
        <p>Bring your experience. We’ll help you put it to work.</p>
      </div>
      <StartLink className="v2-button">
        Tailor your CV — it’s free <ArrowRight size={16} />
      </StartLink>
    </section>
  );
}

export default function NewDesignPages({
  concept,
  pricing,
}: {
  concept: NewConcept;
  pricing: boolean;
}) {
  return (
    <NewShell concept={concept} pricing={pricing}>
      {pricing ? (
        <>
          <section className="v2-wrap v2-pricing-hero">
            <Link className="v2-back" to={`/designs/${concept}`}>
              ← Back to the product
            </Link>
            <div className="v2-pricing-heading">
              <div>
                <span className="v2-overline">
                  FOR THE MONTH YOU MAKE YOUR MOVE
                </span>
                <h1>
                  More applications.
                  <br />
                  <em>One subscription.</em>
                </h1>
                <p>
                  Unlimited tailoring, AI improvements, and exports.
                  <br />
                  Everything you need to keep your search moving.
                </p>
              </div>
              <Mascot eager />
            </div>
            <SubscriptionOffer concept={concept} full />
          </section>
          <ShortFAQ pricing />
          <Closing />
        </>
      ) : (
        <>
          <Hero concept={concept} />
          <section className="v2-demo-section" id="demo">
            <div className="v2-wrap">
              <div className="v2-section-heading">
                <div>
                  <span className="v2-overline">TAKE IT FOR A SPIN</span>
                  <h2>
                    {concept === "canvas"
                      ? "A clearer CV. A few simple steps."
                      : concept === "momentum"
                        ? "Less starting over. More moving forward."
                        : "Meet your new CV workspace."}
                  </h2>
                </div>
                <span>Click, edit, and explore.</span>
              </div>
              <ProductDemo compactGuide={concept === "momentum"} />
            </div>
          </section>
          <Benefits />
          <section className="v2-pricing-section v2-wrap" id="plans">
            <div className="v2-section-heading">
              <div>
                <span className="v2-overline">
                  MAKE ROOM FOR EVERY OPPORTUNITY
                </span>
                <h2>
                  One subscription.
                  <br />
                  <em>Your whole job search.</em>
                </h2>
              </div>
              <p>
                Go beyond the free limits.
                <br />
                Monthly Pro is built for an active search.
              </p>
            </div>
            <SubscriptionOffer concept={concept} />
          </section>
          <ShortFAQ />
          <Closing />
        </>
      )}
    </NewShell>
  );
}

import { useState } from "react";
import { Link } from "react-router";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  Check,
  CheckCheck,
  CircleCheck,
  FileText,
  ListChecks,
  Plus,
  ShieldCheck,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  DesignShell,
  ExampleDocument,
  Eyebrow,
  FAQ,
  FinalCTA,
  PricingCards,
  StartLink,
  Transformation,
  TrustLine,
} from "./DesignShared";
import { ORIGINAL_SENTENCE, type Concept } from "./concepts";

function JourneyLanding() {
  return (
    <>
      <section className="cv-wrap cv-journey-hero">
        <div className="cv-hero-copy">
          <Eyebrow>
            <span className="cv-status-dot" /> A LITTLE HELP FOR YOUR NEXT BIG
            STEP
          </Eyebrow>
          <h1>
            Your next role.
            <br />
            Your experience.
            <br />
            <span>A better fit.</span>
          </h1>
          <p>
            Tailor your CV to the job you want. Bring your experience, add the
            opportunity, and let’s make the connection clear.
          </p>
          <div className="cv-hero-actions">
            <StartLink />
            <a href="#example" className="cv-text-link">
              See the difference <ArrowDown size={16} />
            </a>
          </div>
          <div className="cv-free-note">
            <Check size={15} /> Free to start. No card required.
          </div>
        </div>
        <div className="cv-journey-art">
          <div className="cv-journey-orbit" aria-hidden="true" />
          <div className="cv-art-note">
            You’ve got the experience.
            <br />
            <span>Let’s help it shine.</span>
            <svg viewBox="0 0 100 45" aria-hidden="true">
              <path d="M5 5 Q70 0 80 35 M68 29 L81 38 L87 24" />
            </svg>
          </div>
          <img
            className="cv-mascot-art"
            src="/images/cover-tailor-resume.webp"
            width="1672"
            height="941"
            alt="Our turquoise mascot carefully tailoring a CV to a job description"
            fetchPriority="high"
          />
          <div className="cv-floating-role">
            <span className="cv-icon-tile">
              <BriefcaseBusiness size={20} />
            </span>
            <div>
              <small>YOUR NEXT OPPORTUNITY</small>
              <strong>Data Analyst</strong>
              <span>Excel · Sales analysis · Reporting</span>
            </div>
            <span className="cv-peach-star" aria-hidden="true">
              ✦
            </span>
          </div>
          <div className="cv-floating-result">
            <div>
              <span>
                <CircleCheck size={17} /> Made relevant. Still you.
              </span>
              <span>EXAMPLE</span>
            </div>
            <p>
              “Prepared weekly <mark>Excel reports</mark> to track{" "}
              <mark>sales performance</mark> and highlight trends.”
            </p>
            <small>Based on the experience you confirm.</small>
          </div>
        </div>
      </section>
      <div className="cv-wrap">
        <TrustLine />
      </div>
      <section
        className="cv-wrap cv-section cv-journey-process"
        id="how-it-works"
      >
        <div className="cv-section-heading">
          <Eyebrow>FROM “WHERE DO I START?” TO “READY TO SEND.”</Eyebrow>
          <h2>
            A few small steps.
            <br />
            <span>A more focused application.</span>
          </h2>
          <p>You bring the story. We help you tell the relevant part.</p>
        </div>
        <div className="cv-journey-steps">
          {[
            {
              icon: Upload,
              title: "Bring your experience",
              body: "Upload your existing CV. Your skills, experience, and education are the starting point.",
              note: "your-cv.pdf",
              label: "01",
            },
            {
              icon: BriefcaseBusiness,
              title: "Add the opportunity",
              body: "Paste the job description. See which requirements matter for this particular role.",
              note: "Data Analyst",
              label: "02",
            },
            {
              icon: ListChecks,
              title: "Make it yours",
              body: "Choose the keywords that fit. Add supporting details and review the suggested changes.",
              note: "You’re in control",
              label: "03",
            },
            {
              icon: FileText,
              title: "Take the next step",
              body: "Polish the final details, then export a CV that speaks to this application.",
              note: "Ready to export",
              label: "04",
            },
          ].map(({ icon: Icon, title, body, note, label }) => (
            <article className="cv-journey-step cv-reveal" key={label}>
              <div className="cv-step-illustration">
                <span className="cv-step-count">{label}</span>
                <div className="cv-step-paper">
                  <Icon size={32} strokeWidth={1.5} />
                  <span>{note}</span>
                  <div className="cv-paper-line" />
                  <div className="cv-paper-line short" />
                </div>
                <span className="cv-step-check">
                  <Check size={16} />
                </span>
              </div>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="cv-journey-example" id="example">
        <div className="cv-wrap cv-section">
          <div className="cv-section-heading">
            <Eyebrow>THE DIFFERENCE IS IN THE DETAILS</Eyebrow>
            <h2>
              Same experience.
              <br />
              <span>Clearer connection.</span>
            </h2>
            <p>A good edit makes your relevant experience easier to see.</p>
          </div>
          <Transformation />
        </div>
      </section>
      <section className="cv-wrap cv-section cv-journey-control">
        <div className="cv-control-image">
          <img
            src="/images/cover-before-after.webp"
            width="1672"
            height="941"
            alt="The turquoise mascot presents a clearer, better organized CV"
            loading="lazy"
          />
          <span className="cv-image-caption">
            <ShieldCheck size={16} /> Your story is in good hands. Yours.
          </span>
        </div>
        <div>
          <Eyebrow>A HELPFUL PARTNER. YOU’RE THE AUTHOR.</Eyebrow>
          <h2>
            A little support.
            <br />
            <span>A lot of you.</span>
          </h2>
          <p>
            You know your experience best. Keep the details that fit, add the
            context only you can, and have the final word on every change.
          </p>
          <ul className="cv-check-list">
            <li>
              <CheckCheck />
              Choose relevant keywords
            </li>
            <li>
              <CheckCheck />
              Add evidence from your own experience
            </li>
            <li>
              <CheckCheck />
              Review and edit before exporting
            </li>
          </ul>
          <StartLink className="cv-text-link">
            Let’s tailor your CV <ArrowRight size={17} />
          </StartLink>
        </div>
      </section>
      <section className="cv-wrap cv-section" id="plans">
        <div className="cv-section-heading">
          <Eyebrow>SPACE TO START. ROOM TO GROW.</Eyebrow>
          <h2>Your search. Your pace.</h2>
          <p>
            Try it free, with clear monthly limits. Go Pro when you need more.
          </p>
        </div>
        <PricingCards concept="journey" teaser />
      </section>
      <FAQ />
      <FinalCTA concept="journey" />
    </>
  );
}

function ProductWorkbench() {
  const [step, setStep] = useState(2);
  const [selected, setSelected] = useState([
    "Excel",
    "Sales analysis",
    "Weekly reporting",
  ]);
  const [reviewed, setReviewed] = useState(false);
  const toggle = (value: string) => {
    setSelected((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
    setReviewed(false);
  };
  const hasExcel = selected.includes("Excel");
  const hasSales = selected.includes("Sales analysis");
  const hasWeekly = selected.includes("Weekly reporting");
  const sentence =
    selected.length === 0
      ? ORIGINAL_SENTENCE
      : `Prepared ${hasWeekly ? "weekly " : ""}${hasExcel ? "Excel " : ""}reports${hasSales ? " to track sales performance and highlight trends" : " using sales data"}.`;
  return (
    <div className="cv-workbench" id="demo">
      <div className="cv-workbench-chrome">
        <span className="cv-window-dots">
          <i />
          <i />
          <i />
        </span>
        <span>your next application / data analyst</span>
        <span>
          <span className="cv-status-dot" /> Interactive sample
        </span>
      </div>
      <div className="cv-workbench-body">
        <aside className="cv-workbench-sidebar">
          <span className="cv-small-label">YOUR WORKSPACE</span>
          {[
            { icon: FileText, label: "Your experience" },
            { icon: BriefcaseBusiness, label: "The opportunity" },
            { icon: Sparkles, label: "Tailored to fit" },
          ].map(({ icon: Icon, label }, index) => (
            <button
              key={label}
              className={step === index ? "is-active" : ""}
              onClick={() => setStep(index)}
              aria-pressed={step === index}
            >
              <Icon size={17} />
              {label}
              <span>0{index + 1}</span>
            </button>
          ))}
          <div className="cv-workbench-sidebar-note">
            <ShieldCheck size={20} />
            <strong>
              Your experience.
              <br />
              Your final say.
            </strong>
            <p>Suggestions are a starting point. You review the result.</p>
          </div>
          <div className="cv-sample-person">
            <span>AM</span>
            <div>
              Alex Morgan<small>Fictional sample applicant</small>
            </div>
          </div>
        </aside>
        <div className="cv-workbench-main">
          <div className="cv-workbench-title">
            <div>
              <span className="cv-small-label">APPLICATION / 001</span>
              <h3>
                {
                  [
                    "Start with what you’ve done.",
                    "Understand what matters.",
                    "Make the connection clear.",
                  ][step]
                }
              </h3>
            </div>
            <span className="cv-workbench-step">STEP 0{step + 1}</span>
          </div>
          {step === 0 ? (
            <div className="cv-demo-upload">
              <div className="cv-uploaded-file">
                <FileText size={29} />
                <div>
                  <strong>alex-morgan-cv.pdf</strong>
                  <span>Illustrative uploaded CV</span>
                </div>
                <CircleCheck size={22} />
              </div>
              <h4>Your original experience</h4>
              <blockquote>“{ORIGINAL_SENTENCE}”</blockquote>
              <p>
                Start with the experience you already have. The original wording
                remains available for comparison.
              </p>
              <button className="cv-button" onClick={() => setStep(1)}>
                See the job requirements <ArrowRight size={15} />
              </button>
            </div>
          ) : step === 1 ? (
            <div className="cv-demo-job">
              <span className="cv-job-label">
                <BriefcaseBusiness size={17} /> EXAMPLE JOB DESCRIPTION
              </span>
              <h4>Data Analyst</h4>
              <p>
                Help the team understand sales performance through clear,
                consistent reporting.
              </p>
              <ul>
                <li>Prepare weekly reporting in Excel.</li>
                <li>Analyze sales performance and identify trends.</li>
                <li>Use SQL to query sales data.</li>
              </ul>
              <div className="cv-sql-note">
                <ShieldCheck size={16} /> SQL needs supporting experience. It
                won’t be added to this sample.
              </div>
              <button className="cv-button" onClick={() => setStep(2)}>
                Review the tailored version <ArrowRight size={15} />
              </button>
            </div>
          ) : (
            <>
              <div className="cv-workbench-keywords">
                <span>Focus on what fits your background</span>
                <div>
                  {["Excel", "Sales analysis", "Weekly reporting"].map(
                    (keyword) => (
                      <button
                        key={keyword}
                        aria-pressed={selected.includes(keyword)}
                        onClick={() => toggle(keyword)}
                      >
                        {selected.includes(keyword) ? (
                          <Check size={13} />
                        ) : (
                          <Plus size={13} />
                        )}
                        {keyword}
                      </button>
                    ),
                  )}
                  <span className="cv-disabled-keyword">
                    SQL <span>Needs evidence</span>
                  </span>
                </div>
              </div>
              <div className="cv-workbench-comparison">
                <div>
                  <span className="cv-small-label">ORIGINAL</span>
                  <p>{ORIGINAL_SENTENCE}</p>
                </div>
                <ArrowDown size={17} />
                <div>
                  <span className="cv-small-label">
                    <Sparkles size={13} /> TAILORED DRAFT
                  </span>
                  <p aria-live="polite">{sentence}</p>
                </div>
              </div>
              <div className="cv-workbench-bottom">
                <p>
                  <ShieldCheck size={15} /> Sample assumes sales analysis is
                  confirmed.
                  <br />
                  Changes stay grounded in your evidence.
                </p>
                <button
                  className={`cv-button ${reviewed ? "is-reviewed" : ""}`}
                  onClick={() => setReviewed(!reviewed)}
                  aria-pressed={reviewed}
                >
                  {reviewed ? "Reviewed" : "Mark as reviewed"}{" "}
                  <CheckCheck size={16} />
                </button>
              </div>
              <div className="cv-review-status" role="status">
                {reviewed
                  ? "Sample reviewed. In your account, you can now finalize and export your CV."
                  : "Try selecting a keyword to see how the wording changes."}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StudioLanding() {
  return (
    <>
      <section className="cv-wrap cv-studio-hero">
        <Eyebrow>
          <span className="cv-status-dot" /> BUILT FOR THE ROLE YOU’RE AFTER
        </Eyebrow>
        <h1>
          Good experience.
          <br />
          <span>Precisely presented.</span>
        </h1>
        <p>
          Your CV, tailored to a specific job. Turn the experience you have
          <br className="cv-desktop-break" /> into the application you mean to
          send.
        </p>
        <div className="cv-hero-actions">
          <StartLink>
            Tailor my CV free <ArrowUpRight size={18} />
          </StartLink>
          <a href="#demo" className="cv-button cv-button-outline">
            Explore the product <ArrowDown size={16} />
          </a>
        </div>
        <div className="cv-free-note">
          No card required <span>·</span> You review every change
        </div>
        <ProductWorkbench />
      </section>
      <div className="cv-wrap">
        <TrustLine />
      </div>
      <section
        className="cv-wrap cv-section cv-studio-process"
        id="how-it-works"
      >
        <div className="cv-section-heading cv-heading-split">
          <div>
            <Eyebrow>A STRAIGHT LINE TO A STRONGER CV</Eyebrow>
            <h2>
              Less starting over.
              <br />
              <span>More moving forward.</span>
            </h2>
          </div>
          <p>
            One focused workflow, from your existing CV to your next
            application.
          </p>
        </div>
        <div className="cv-studio-steps">
          {[
            {
              icon: Upload,
              title: "Bring your CV",
              text: "Upload a PDF or DOCX. Start with your own experience.",
            },
            {
              icon: BriefcaseBusiness,
              title: "Add the role",
              text: "Paste the job description. Find the requirements that matter.",
            },
            {
              icon: ListChecks,
              title: "Review the fit",
              text: "Select keywords, supply evidence, and check the changes.",
            },
            {
              icon: ArrowUpRight,
              title: "Make your move",
              text: "Export a focused PDF or DOCX, ready for your application.",
            },
          ].map(({ icon: Icon, title, text }, index) => (
            <article className="cv-reveal" key={title}>
              <div>
                <span>0{index + 1}</span>
                <Icon size={22} />
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="cv-studio-proof" id="example">
        <div className="cv-wrap cv-section">
          <div className="cv-section-heading cv-heading-split">
            <div>
              <Eyebrow>RELEVANCE YOU CAN READ</Eyebrow>
              <h2>
                No mystery score.
                <br />
                <span>Just a clearer story.</span>
              </h2>
            </div>
            <p>
              Compare the actual words. See why they changed. Decide whether
              they belong on your CV.
            </p>
          </div>
          <Transformation />
          <div className="cv-studio-principles">
            <div>
              <ShieldCheck size={24} />
              <h3>Evidence comes first.</h3>
              <p>
                A missing skill is a prompt for your input. It isn’t a new
                qualification.
              </p>
            </div>
            <div>
              <ListChecks size={24} />
              <h3>The last word is yours.</h3>
              <p>
                Accept what works. Edit what doesn’t. Keep it accurate to your
                experience.
              </p>
            </div>
            <div>
              <FileText size={24} />
              <h3>Ready for the next step.</h3>
              <p>Take a tailored PDF or DOCX into your application workflow.</p>
            </div>
          </div>
        </div>
      </section>
      <section className="cv-wrap cv-section" id="plans">
        <div className="cv-section-heading">
          <Eyebrow>START SMALL. APPLY WITH FOCUS.</Eyebrow>
          <h2>
            Plans that keep up
            <br />
            <span>with your next move.</span>
          </h2>
          <p>A free starting point. More room when you need it.</p>
        </div>
        <PricingCards concept="studio" teaser />
      </section>
      <FAQ />
      <FinalCTA concept="studio" />
    </>
  );
}

function EditorialLanding() {
  return (
    <>
      <section className="cv-wrap cv-editorial-hero">
        <div className="cv-editorial-kicker">
          <span>YOUR EXPERIENCE, EDITED FOR OPPORTUNITY.</span>
          <span>THE NEXT CHAPTER / NO. 001</span>
        </div>
        <div className="cv-editorial-hero-grid">
          <div className="cv-hero-copy">
            <h1>
              You’ve done
              <br />
              the work.
              <br />
              <em>
                Now, make
                <br />
                it relevant.
              </em>
            </h1>
            <div className="cv-editorial-intro">
              <span className="cv-editorial-asterisk" aria-hidden="true">
                ✳
              </span>
              <div>
                <p>
                  A CV for the job you want, built from the experience you have.
                  Thoughtfully tailored. Always yours.
                </p>
                <StartLink>
                  Write your next chapter <ArrowUpRight size={18} />
                </StartLink>
                <div className="cv-free-note">
                  Start free. No card required.
                </div>
              </div>
            </div>
          </div>
          <div className="cv-editorial-collage">
            <div className="cv-editorial-red-card">
              <span>
                A LITTLE FOCUS
                <br />
                CHANGES THE STORY.
              </span>
              <ArrowUpRight size={57} strokeWidth={1} />
            </div>
            <div className="cv-editorial-document">
              <ExampleDocument editorial />
            </div>
            <span className="cv-editorial-stamp">
              YOUR STORY
              <br />
              <strong>
                STILL
                <br />
                YOURS.
              </strong>
              <span>REVIEW EVERY CHANGE</span>
            </span>
            <div className="cv-editorial-collage-caption">
              <span>01 — THE TAILORED CV</span>
              <span>Illustrative sample</span>
            </div>
          </div>
        </div>
      </section>
      <div
        className="cv-editorial-marquee"
        aria-label="Your experience, their opportunity, a clearer connection"
      >
        <span>YOUR EXPERIENCE</span>
        <Plus />
        <span>THEIR OPPORTUNITY</span>
        <span>=</span>
        <span>A CLEARER CONNECTION</span>
        <ArrowUpRight />
      </div>
      <section
        className="cv-wrap cv-section cv-editorial-process"
        id="how-it-works"
      >
        <div className="cv-editorial-section-label">
          <span>01 / THE PROCESS</span>
          <ArrowDown size={18} />
        </div>
        <div className="cv-editorial-process-content">
          <h2>
            You don’t need
            <br />a new story.
            <br />
            <em>Just the right edit.</em>
          </h2>
          <div>
            {[
              {
                title: "Start with what’s yours.",
                text: "Your existing CV is the source. Upload it as a PDF or DOCX, with the work, skills, and experience you already have.",
              },
              {
                title: "Read the opportunity.",
                text: "Add the job description. Find the places where your experience meets what this employer is looking for.",
              },
              {
                title: "Make a thoughtful edit.",
                text: "Select the relevant keywords. Add your evidence, check the suggestions, and keep every detail true to you.",
              },
              {
                title: "Send the relevant version.",
                text: "Export your tailored CV as PDF or DOCX. One application, with a clearer sense of purpose.",
              },
            ].map(({ title, text }, index) => (
              <article className="cv-reveal" key={title}>
                <span>0{index + 1}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="cv-editorial-example" id="example">
        <div className="cv-wrap cv-section">
          <div className="cv-editorial-section-label">
            <span>02 / A CLOSER LOOK</span>
            <span>THE DATA ANALYST APPLICATION</span>
          </div>
          <div className="cv-section-heading">
            <h2>
              The experience stays.
              <br />
              <em>The emphasis changes.</em>
            </h2>
            <p>
              The useful part of tailoring is making a connection the reader can
              see.
            </p>
          </div>
          <Transformation />
        </div>
      </section>
      <section className="cv-wrap cv-section cv-editorial-output">
        <div>
          <Eyebrow>03 / THE FINISHED PIECE</Eyebrow>
          <h2>
            Considered words.
            <br />
            Clean presentation.
            <br />
            <em>Ready to go.</em>
          </h2>
          <p>
            Keep the focus on what you bring to the role. Review the wording,
            make your final edits, and take your tailored document with you.
          </p>
          <div className="cv-export-tags">
            <span>
              <FileText size={17} /> PDF
            </span>
            <span>
              <FileText size={17} /> DOCX
            </span>
            <span>
              <Check size={17} /> Reviewed by you
            </span>
          </div>
          <Link className="cv-text-link" to="/career-advice">
            A little advice for your next move <ArrowUpRight size={17} />
          </Link>
        </div>
        <div className="cv-editorial-output-note">
          <span className="cv-editorial-asterisk" aria-hidden="true">
            ✳
          </span>
          <blockquote>
            “The strongest version
            <br />
            of your CV is still
            <br />
            <em>your CV.</em>”
          </blockquote>
          <span>OUR APPROACH TO TAILORING</span>
        </div>
      </section>
      <section className="cv-wrap cv-section" id="plans">
        <div className="cv-editorial-section-label">
          <span>04 / ROOM FOR YOUR AMBITION</span>
          <span>FREE TO BEGIN</span>
        </div>
        <div className="cv-section-heading">
          <h2>
            Your next chapter.
            <br />
            <em>At your own pace.</em>
          </h2>
        </div>
        <PricingCards concept="editorial" teaser />
      </section>
      <FAQ />
      <FinalCTA concept="editorial" />
    </>
  );
}

export function DesignLanding({ concept }: { concept: Concept }) {
  return (
    <DesignShell concept={concept}>
      {concept === "journey" ? (
        <JourneyLanding />
      ) : concept === "studio" ? (
        <StudioLanding />
      ) : (
        <EditorialLanding />
      )}
    </DesignShell>
  );
}

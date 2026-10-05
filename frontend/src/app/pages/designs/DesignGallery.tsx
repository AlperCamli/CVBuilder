import { ArrowRight, ArrowUpRight, FileText } from "lucide-react";
import { Link } from "react-router";
import { CONCEPTS, isNewConcept } from "./concepts";
import { ReviewBar } from "./DesignShared";
import { SHOWCASE_DIRECTIONS, showcasePath } from "./template-showcase-data";
import "./template-showcase.css";

export function DesignGallery() {
  return (
    <div className="cv-concept cv-gallery">
      <ReviewBar />
      <main className="cv-wrap">
        <header className="cv-gallery-heading">
          <div className="cv-wordmark">
            <FileText size={23} />
            jobspecific<span>CV</span>.
          </div>
          <span className="cv-gallery-edition">
            DESIGN EXPLORATIONS / SEPTEMBER 2026
          </span>
          <h1>
            Six ways to
            <br />
            <em>make the next move.</em>
          </h1>
          <p>
            Three new directions. Mascot guidance meets the real product.
            <br />
            Explore each landing page and its matching pricing experience.
          </p>
        </header>
        <section className="ts-gallery-intro">
          <h2>One collection. Three ways to show it.</h2>
          <p>
            Seven real CV templates, placed between the Guided Journey demo and
            pricing.
          </p>
          <div className="ts-gallery-links">
            {SHOWCASE_DIRECTIONS.map((direction, index) => (
              <Link
                key={direction.id}
                to={`${showcasePath(direction.id)}#templates`}
              >
                <strong>
                  {index + 1}. {direction.name}
                  <ArrowUpRight size={18} />
                </strong>
                <p>{direction.description}</p>
              </Link>
            ))}
          </div>
        </section>
        <section className="cv-gallery-combined">
          <div>
            <span>LATEST DIRECTION · JOURNEY + COMPANION</span>
            <h2>A little guidance. Every step of the way.</h2>
            <p>
              Journey’s warm visuals, the real product demo, and a companion who
              takes you from first edit to first application.
            </p>
            <div>
              <Link to="/designs/guided-journey">
                Explore the combined design <ArrowRight size={17} />
              </Link>
              <Link to="/designs/guided-journey/pricing">
                Pricing <ArrowUpRight size={15} />
              </Link>
            </div>
          </div>
          <img
            src="/images/designs/mascot/guide.webp"
            width="1024"
            height="1536"
            alt="Your friendly guide"
          />
        </section>
        {[true, false].map((newRound) => (
          <section className="cv-gallery-round" key={String(newRound)}>
            <div className="cv-gallery-round-heading">
              <h2>
                {newRound
                  ? "Round 02 — Built around your feedback"
                  : "Round 01 — The first explorations"}
              </h2>
              <span>{newRound ? "NEW · 04–06" : "01–03"}</span>
            </div>
            <div className="cv-gallery-grid">
              {CONCEPTS.filter(
                (concept) => isNewConcept(concept.id) === newRound,
              ).map((concept) => (
                <article
                  className={`cv-gallery-card cv-gallery-${concept.id}`}
                  key={concept.id}
                >
                  <Link
                    to={`/designs/${concept.id}`}
                    className="cv-gallery-preview"
                    aria-label={`View ${concept.name} landing page`}
                  >
                    <img
                      src={`/images/designs/${concept.id}.png`}
                      width="1440"
                      height="1000"
                      alt={`${concept.label} landing page preview`}
                    />
                    <span className="cv-gallery-preview-cta">
                      Explore direction <ArrowUpRight size={19} />
                    </span>
                  </Link>
                  <div className="cv-gallery-card-body">
                    <div className="cv-gallery-card-meta">
                      <span>DIRECTION {concept.number}</span>
                      <span
                        className="cv-gallery-swatches"
                        aria-label={`${concept.label} color palette`}
                      >
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                    <h2>{concept.name}</h2>
                    <p className="cv-gallery-tagline">{concept.description}</p>
                    <p>{concept.details}</p>
                    <div className="cv-gallery-practice">
                      {concept.practice}
                    </div>
                    <div className="cv-gallery-card-links">
                      <Link to={`/designs/${concept.id}`}>
                        Landing page <ArrowUpRight size={16} />
                      </Link>
                      <Link to={`/designs/${concept.id}/pricing`}>
                        Pricing <ArrowUpRight size={16} />
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))}
        <section className="cv-gallery-review-note">
          <div>
            <h2>Same fundamentals. Different first impressions.</h2>
            <p>
              The new directions combine mascot guidance, a demo using the
              actual CV renderer, shorter copy, and a stronger Monthly Pro
              offer. The first three explorations are still here for comparison.
            </p>
          </div>
          <Link to="/">
            View the current site <ArrowRight size={17} />
          </Link>
        </section>
        <footer className="cv-gallery-footer">
          <span>
            Design review · Current landing and pricing pages preserved
          </span>
          <span>JobSpecificCV</span>
        </footer>
      </main>
    </div>
  );
}

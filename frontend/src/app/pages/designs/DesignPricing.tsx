import { ArrowDown, ArrowUpRight, Check, Sparkles } from "lucide-react";
import { Link } from "react-router";
import {
  DesignShell,
  Eyebrow,
  FAQ,
  FinalCTA,
  PlanComparison,
  PricingCards,
} from "./DesignShared";
import type { Concept } from "./concepts";

export function DesignPricing({ concept }: { concept: Concept }) {
  return (
    <DesignShell concept={concept} pricing>
      <section className="cv-wrap cv-pricing-page-hero">
        <Link to={`/designs/${concept}`} className="cv-back-link">
          ← Back to the story
        </Link>
        {concept === "editorial" ? (
          <div className="cv-editorial-pricing-heading">
            <div>
              <Eyebrow>A LITTLE INVESTMENT IN YOUR NEXT CHAPTER.</Eyebrow>
              <h1>
                Big ambitions.
                <br />
                <em>Simple plans.</em>
              </h1>
            </div>
            <p>
              Start with what you need.
              <br />
              Make room for what comes next.
              <br />
              <a href="#comparison" className="cv-text-link">
                Compare the details <ArrowDown size={16} />
              </a>
            </p>
          </div>
        ) : (
          <div className="cv-section-heading">
            <Eyebrow>
              {concept === "journey"
                ? "A PLAN FOR WHEREVER YOU ARE IN YOUR SEARCH"
                : "MORE FOCUS. CLEARER PRICING."}
            </Eyebrow>
            <h1>
              {concept === "journey" ? (
                <>
                  Your next step.
                  <br />
                  <span>At your own pace.</span>
                </>
              ) : (
                <>
                  A plan for
                  <br />
                  <span>your next move.</span>
                </>
              )}
            </h1>
            <p>
              {concept === "journey"
                ? "Begin with a little help. Give yourself more room when you need it."
                : "Start free. Go further with Pro. The price you see is the amount billed."}
            </p>
          </div>
        )}
        <PricingCards concept={concept} />
        <div className="cv-pricing-assurances">
          <span>
            <Check size={16} /> Free means no card required
          </span>
          <span>
            <Sparkles size={16} /> Same Pro features, every billing period
          </span>
          <span>
            <ArrowUpRight size={16} /> Confirm your selection at checkout
          </span>
        </div>
      </section>
      <div id="comparison">
        <PlanComparison />
      </div>
      <FAQ pricing />
      <FinalCTA concept={concept} />
    </DesignShell>
  );
}

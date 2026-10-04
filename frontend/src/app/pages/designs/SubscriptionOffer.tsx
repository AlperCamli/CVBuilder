import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Download,
  FileCheck2,
  Infinity as InfinityIcon,
  Sparkles,
} from "lucide-react";
import {
  isCheckoutTarget,
  type CheckoutTarget,
} from "../../../content/pricing";
import { setPendingCheckout } from "../../integration/pending-checkout";
import { BILLING, type NewConcept } from "./concepts";
import { StartLink } from "./DesignShared";

export function SubscriptionOffer({
  concept,
  full = false,
}: {
  concept: NewConcept;
  full?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const query = params.get("billing");
  const [localPeriod, setLocalPeriod] = useState<CheckoutTarget>("monthly");
  const period = full
    ? isCheckoutTarget(query)
      ? query
      : "monthly"
    : localPeriod;
  const price = BILLING[period];
  const navigate = useNavigate();
  const choosePro = () => {
    setPendingCheckout({
      plan_code: period,
      ...(period === "weekly" ? { with_trial: false } : {}),
    });
    navigate("/signup", { state: { from: "/app/create" } });
  };
  const select = (value: CheckoutTarget) => {
    setLocalPeriod(value);
    if (full)
      setParams(
        { billing: value },
        { replace: true, preventScrollReset: true },
      );
  };
  return (
    <div className="v2-offer">
      <div className="v2-periods" role="group" aria-label="Pro billing period">
        {(Object.keys(BILLING) as CheckoutTarget[]).map((value) => (
          <button
            key={value}
            aria-pressed={period === value}
            onClick={() => select(value)}
          >
            {BILLING[value].label}
            {value === "monthly" && <span>Recommended</span>}
          </button>
        ))}
      </div>
      <div className="v2-subscription-grid">
        <article className="v2-pro-card">
          <div className="v2-pro-top">
            <div>
              <span className="v2-overline">
                YOUR JOB SEARCH, WITHOUT THE LIMITS
              </span>
              <h3>
                JobSpecificCV Pro
                <span>
                  {period === "monthly"
                    ? "The active-search plan"
                    : `${price.label} billing`}
                </span>
              </h3>
            </div>
            <InfinityIcon
              className="v2-pro-infinity"
              size={55}
              strokeWidth={1.3}
            />
          </div>
          <div className="v2-pro-main">
            <div>
              <p className="v2-subscription-pitch">
                A tailored CV for every opportunity.
              </p>
              <div className="v2-pro-benefits">
                <div>
                  <FileCheck2 size={19} />
                  <span>
                    <strong>Apply to more roles</strong>Unlimited tailored CVs
                  </span>
                </div>
                <div>
                  <Sparkles size={19} />
                  <span>
                    <strong>Keep refining your story</strong>Unlimited AI
                    actions
                  </span>
                </div>
                <div>
                  <Download size={19} />
                  <span>
                    <strong>Send it your way</strong>Unlimited PDF & DOCX
                    exports
                  </span>
                </div>
              </div>
            </div>
            <div className="v2-pro-purchase">
              <div className="v2-offer-price" aria-live="polite">
                <strong>{price.price}</strong>
                <span>/ {price.interval}</span>
              </div>
              <p>
                {price.price} billed {period === "annual" ? "annually" : period}
                .
              </p>
              <button className="v2-button" onClick={choosePro}>
                Get Pro {price.label.toLowerCase()} <ArrowRight size={17} />
              </button>
              <small>
                {price.renewal}.<br />
                Confirm your plan at checkout.
                {period === "weekly" && <> This choice has no trial.</>}
              </small>
            </div>
          </div>
        </article>
        <article className="v2-free-card">
          <div>
            <span className="v2-overline">JUST GETTING STARTED?</span>
            <h3>Free</h3>
            <div className="v2-free-price">
              $0 <span>/ month</span>
            </div>
          </div>
          <ul>
            <li>
              <Check size={15} />3 tailored CVs / month
            </li>
            <li>
              <Check size={15} />5 exports / month
            </li>
            <li>
              <Check size={15} />
              20 AI actions / month
            </li>
          </ul>
          <StartLink className="v2-free-link">
            Start free <ArrowRight size={15} />
          </StartLink>
          <p>No card required. Limits apply separately.</p>
        </article>
      </div>
      {full ? (
        <details className="v2-plan-details">
          <summary>
            Compare all plan limits <ChevronDown size={17} />
          </summary>
          <div className="v2-plan-table">
            <table>
              <caption className="pd-sr-only">Free and Pro plan limits</caption>
              <thead>
                <tr>
                  <th scope="col">Included</th>
                  <th scope="col">Free</th>
                  <th scope="col">Pro</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["Tailored CVs", "3 / month", "Unlimited"],
                  ["PDF & DOCX exports", "5 / month", "Unlimited"],
                  ["AI actions", "20 / month", "Unlimited"],
                  ["Storage", "25 MB", "Unlimited"],
                  ["Review & edit", "Included", "Included"],
                ].map(([label, free, pro]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td>{free}</td>
                    <td>{pro}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            An AI action is a request such as a rewrite or suggestion. Tailoring
            can also use AI actions. All Pro billing periods include the same
            features.
          </p>
        </details>
      ) : (
        <Link
          className="v2-all-pricing"
          to={`/designs/${concept}/pricing?billing=${period}`}
        >
          Compare plans <ArrowRight size={15} />
        </Link>
      )}
    </div>
  );
}

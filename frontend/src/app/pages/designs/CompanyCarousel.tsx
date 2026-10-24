import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { translate as t } from "../../localization/i18n";
import type { BillingPrices } from "../../integration/regional-pricing";
import { companiesForMarket, hasVerifiedEmployment, type Company } from "./company-carousel-data";
import "./company-carousel.css";

function CompanyLogo({ company }: { company: Company }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="gj-company-logo">
      {failed ? <span>{company.name}</span> : (
        <img src={company.logo} alt={company.name} width={160} height={56}
          loading="lazy" decoding="async" onError={() => setFailed(true)} />
      )}
    </div>
  );
}

export function CompanyCarousel({ market, companies = companiesForMarket(market) }: {
  market?: BillingPrices["market"] | null;
  companies?: readonly Company[];
}) {
  useTranslation();
  const titleId = useId();
  if (!companies.length) return null;
  const verified = hasVerifiedEmployment(companies);
  return (
    <section id="companies" className="gj-companies cv-wrap" aria-labelledby={titleId}>
      <div className="gj-companies-heading">
        <span className="cv-eyebrow">{t("BIG AMBITIONS. YOUR NEXT CHAPTER.")}</span>
        <h2 id={titleId}>{verified
          ? t("Employees from Best Companies uses jobspecificCV:")
          : t("Make your next move count.")}</h2>
        <p>{verified
          ? t("People who built their CVs with JobSpecificCV now work at these companies.")
          : t("Tailor your CV for opportunities at companies like these.")}</p>
      </div>
      <div className="gj-company-carousel" tabIndex={0} role="group" aria-labelledby={titleId}>
        <div className="gj-company-window">
          <div className="gj-company-track" style={{ animationDuration: `${Math.max(24, companies.length * 6)}s` }}>
            {[0, 1].map((copy) => (
              <ul className="gj-company-group" key={copy} aria-hidden={copy === 1 ? true : undefined}>
                {companies.map((company) => <li key={company.id}><CompanyLogo company={company} /></li>)}
              </ul>
            ))}
          </div>
        </div>
      </div>
      <p className="gj-companies-note">{t("Company names and logos belong to their owners. No affiliation or endorsement is implied.")}</p>
    </section>
  );
}

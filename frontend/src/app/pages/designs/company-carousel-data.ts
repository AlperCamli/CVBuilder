import type { BillingPrices } from "../../integration/regional-pricing";

/** Official artwork provenance. Employment evidence is reviewed separately.
 * Add companies here; no carousel markup changes are needed. */
export type Company = {
  id: string;
  name: string;
  logo: string;
  logoSource: string;
  employmentEvidence: { reference: string; verifiedOn: string } | null;
};

// The owner confirmed they hold employment evidence for all five companies
// in the landing page task on 2026-10-24. No customer documents are stored here.
const ownerConfirmedEvidence = () => ({
  reference: "Owner confirmation in landing page task, 2026-10-24",
  verifiedOn: "2026-10-24",
});

export const COMPANIES: readonly Company[] = [
  {
    id: "amazon", name: "Amazon", logo: "/images/companies/amazon.svg",
    logoSource: "https://assets.aboutamazon.com/59/21/d658597b447d97f8bc9aef3362e0/logo-inverse-1.svg",
    employmentEvidence: ownerConfirmedEvidence(),
  },
  {
    id: "accenture", name: "Accenture", logo: "/images/companies/accenture.svg",
    logoSource: "https://www.accenture.com/us-en",
    employmentEvidence: ownerConfirmedEvidence(),
  },
  {
    id: "coca-cola", name: "Coca-Cola", logo: "/images/companies/coca-cola.svg",
    logoSource: "https://www.coca-cola.com/content/dam/onexp/global/icons/Coke-company-logo-black.svg",
    employmentEvidence: ownerConfirmedEvidence(),
  },
  {
    id: "jotform", name: "Jotform", logo: "/images/companies/jotform.svg",
    logoSource: "https://cdn.jotfor.ms/assets/resources/svg/jotform-logo-dark.svg",
    employmentEvidence: ownerConfirmedEvidence(),
  },
  {
    id: "trendyol", name: "Trendyol", logo: "/images/companies/trendyol.svg",
    logoSource: "https://cdn.dsmcdn.com/web/logo/ty-web.svg",
    employmentEvidence: ownerConfirmedEvidence(),
  },
  {
    id: "qnb", name: "QNB", logo: "/images/companies/qnb.png",
    logoSource: "https://www.qnb.com.tr/_assets/img/logo.png",
    employmentEvidence: {
      reference: "Owner-requested addition to Turkey employment carousel, 2026-10-24",
      verifiedOn: "2026-10-24",
    },
  },
  {
    id: "akbank", name: "Akbank", logo: "/images/companies/akbank.svg",
    logoSource: "https://www.akbank.com/SiteAssets/img/logo.svg",
    employmentEvidence: {
      reference: "Owner-requested addition to Turkey employment carousel, 2026-10-24",
      verifiedOn: "2026-10-24",
    },
  },
];

const COMPANIES_BY_MARKET: Record<BillingPrices["market"], readonly Company[]> = {
  TR: COMPANIES,
  GLOBAL: COMPANIES.filter((company) => ["amazon", "accenture", "coca-cola", "jotform"].includes(company.id)),
};

/** Match the pricing response, independently of the chosen interface language.
 * Use the international set while the pricing region is unknown. */
export function companiesForMarket(market?: BillingPrices["market"] | null): readonly Company[] {
  return COMPANIES_BY_MARKET[market ?? "GLOBAL"];
}

/** Never put an unverified company beneath an employment claim. */
export function hasVerifiedEmployment(companies: readonly Company[]): boolean {
  return companies.length > 0 && companies.every(({ employmentEvidence: evidence }) =>
    Boolean(evidence?.reference.trim() && evidence.verifiedOn.trim()),
  );
}

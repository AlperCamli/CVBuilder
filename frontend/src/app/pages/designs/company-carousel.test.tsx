import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CompanyCarousel } from "./CompanyCarousel";
import { COMPANIES, companiesForMarket, hasVerifiedEmployment, type Company } from "./company-carousel-data";
import { i18n } from "../../localization/i18n";

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("company pricing regions", () => {
  it("keeps Turkey's seven companies and excludes local companies internationally or before region detection", () => {
    expect(companiesForMarket("TR")).toEqual(COMPANIES);
    expect(companiesForMarket("TR").map((company) => company.id)).toEqual(["amazon", "accenture", "coca-cola", "jotform", "trendyol", "qnb", "akbank"]);
    expect(companiesForMarket("GLOBAL").map((company) => company.id)).toEqual(["amazon", "accenture", "coca-cola", "jotform"]);
    expect(companiesForMarket(null)).toEqual(companiesForMarket("GLOBAL"));
    expect(companiesForMarket()).toEqual(companiesForMarket("GLOBAL"));
  });
  it("uses the pricing market independently of interface language", async () => {
    expect(renderToStaticMarkup(<CompanyCarousel market="TR" />)).toContain('alt="Trendyol"');
    expect(renderToStaticMarkup(<CompanyCarousel market="TR" />)).toContain('alt="QNB"');
    expect(renderToStaticMarkup(<CompanyCarousel market="TR" />)).toContain('alt="Akbank"');
    await i18n.changeLanguage("tr");
    const html = renderToStaticMarkup(<CompanyCarousel market="GLOBAL" />);
    expect(html).toContain("Önde gelen şirketlerin çalışanları");
    expect(html).not.toContain("Trendyol");
    expect(html).not.toContain('alt="QNB"');
    expect(html).not.toContain('alt="Akbank"');
    expect(renderToStaticMarkup(<CompanyCarousel />)).not.toContain("Trendyol");
  });
});

describe("company employment claims", () => {
  const pending = COMPANIES.map((company) => ({ ...company, employmentEvidence: null }));
  const verified: Company = {
    ...COMPANIES[0],
    employmentEvidence: { reference: "internal/customer-story/example", verifiedOn: "2026-10-24" },
  };
  it("keeps employment claims out of published markup until every displayed company is verified", () => {
    expect(hasVerifiedEmployment(pending)).toBe(false);
    expect(hasVerifiedEmployment([])).toBe(false);
    expect(hasVerifiedEmployment([verified, pending[1]])).toBe(false);
    expect(hasVerifiedEmployment([{ ...verified, employmentEvidence: { reference: " ", verifiedOn: "2026-10-24" } }])).toBe(false);
    const html = renderToStaticMarkup(<CompanyCarousel companies={pending} />);
    expect(html).toContain("Make your next move count.");
    expect(html).not.toContain("Employees from Best Companies");
    expect(html).not.toContain("now work at these companies");
    for (const company of COMPANIES) expect(html).toContain(`alt="${company.name}"`);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<button");
  });
  it("allows the requested employment copy only for a fully evidenced list", () => {
    expect(hasVerifiedEmployment(COMPANIES)).toBe(true);
    expect(renderToStaticMarkup(<CompanyCarousel />)).toContain("Employees from Best Companies uses jobspecificCV:");
    expect(hasVerifiedEmployment([verified])).toBe(true);
    const html = renderToStaticMarkup(<CompanyCarousel companies={[verified]} />);
    expect(html).toContain("Employees from Best Companies uses jobspecificCV:");
    expect(html).toContain("now work at these companies");
    expect(html).not.toContain("internal/customer-story");
  });
  it("localizes the carousel and claim copy in Turkish", async () => {
    await i18n.changeLanguage("tr");
    const html = renderToStaticMarkup(<CompanyCarousel companies={pending} />);
    expect(html).toContain("Kariyerindeki bir sonraki adıma hazırlan.");
    expect(html).not.toContain("Make your next move count.");
    expect(renderToStaticMarkup(<CompanyCarousel companies={[verified]} />)).toContain("Önde gelen şirketlerin çalışanları");
  });
});

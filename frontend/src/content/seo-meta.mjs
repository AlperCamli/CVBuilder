// Single source of truth for per-route SEO metadata (titles, descriptions,
// canonicals, Open Graph/Twitter tags, JSON-LD, sitemap hints).
//
// Consumed by BOTH:
//   - scripts/routes.mjs (Node, prerender + sitemap generation)
//   - src/app/seo/route-seo.tsx (browser, head updates on SPA navigation)
//
// Keep this module pure ESM with no Node-only imports (no fs/path) so it can
// be bundled by Vite. Content JSON is passed in by the caller.

export const SITE_URL = "https://jobspecificcv.com";
export const SITE_NAME = "jobspecificCV";
export const OG_IMAGE = `${SITE_URL}/images/og-image-social.jpg`;
export const DEFAULT_IMAGE_ALT = "jobspecificCV - AI CV builder for job-specific resumes";

export function absoluteUrl(path) {
  return `${SITE_URL}${path}`;
}

export function breadcrumbJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function faqPageJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: SITE_NAME,
  url: `${SITE_URL}/`,
  logo: `${SITE_URL}/images/logo.png`,
};

export const WEB_APPLICATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: SITE_NAME,
  url: `${SITE_URL}/`,
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "An AI-assisted CV builder for creating ATS-friendly CVs tailored to specific job descriptions from a single master CV.",
  featureList: [
    "AI-powered CV tailoring for specific job descriptions",
    "ATS-friendly resume generation",
    "Job description keyword matching",
    "Multiple resume templates",
    "PDF export",
    "Cover letter generation",
    "CV scoring and improvement suggestions",
    "Job application tracker",
  ],
  offers: [
    {
      "@type": "Offer",
      name: "Free",
      price: "0",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
    {
      "@type": "Offer",
      name: "Pro",
      price: "10",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "10",
        priceCurrency: "USD",
        billingDuration: "P1M",
        referenceQuantity: {
          "@type": "QuantitativeValue",
          value: "1",
          unitCode: "MON",
        },
      },
    },
    {
      "@type": "Offer",
      name: "Lifetime",
      price: "99",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
    },
  ],
};

// Must stay in sync with the visible FAQ section in src/app/pages/Landing.tsx
// (see backend/docs/seo-structured-data.md).
export const LANDING_FAQ_ITEMS = [
  {
    question: "What makes this different from other AI CV builders?",
    answer:
      "Our biggest difference is that we keep the human in the loop. Instead of letting AI guess what should be emphasized, we analyze the job description, identify relevant topics and keywords, and then let you choose which ones you want to reflect in your CV. We also ask a few short follow-up questions when needed, so the final result is based on your real experience, not AI assumptions.",
  },
  {
    question: "How does the AI tailor my CV for a specific job?",
    answer:
      "You enter the role, company, and job description. Then the system analyzes the job description, identifies important topics and keywords, gives you multiple relevant options to choose from, asks short follow-up questions when needed, and then suggests updates to your CV based on your selections. This creates a much more relevant CV while still keeping you in control.",
  },
  {
    question: "How do you reduce AI hallucinations?",
    answer:
      "We reduce hallucinations by not relying on blind one-click rewriting. Our process is designed to keep the AI grounded by starting from your real CV, learning from the actual job description, showing you topic and keyword options extracted from that job, letting you select what should be emphasized, asking short follow-up questions instead of guessing, and showing changes for review before they are applied. That human-in-the-loop workflow is one of the main things that makes the product more trustworthy.",
  },
  {
    question: "Why do I have to choose keywords and topics myself?",
    answer:
      "Because that is one of the core strengths of the product. Many AI tools rewrite too much without enough user control. We do it differently: we extract likely keywords and themes from the job description, then let you decide which ones match your real experience and should be reflected in your CV. This gives you more control, more trust, better relevance, and a final CV that still feels like yours.",
  },
  {
    question: "Is this just ChatGPT for resumes?",
    answer:
      "No. General AI tools are open-ended, which means users have to decide the whole process themselves and results can be inconsistent. This product gives you a structured tailoring workflow: job description analysis, topic and keyword selection, short follow-up questions, suggested CV revisions, and human approval before changes are used. It is built specifically for job applications, not generic prompting.",
  },
  {
    question: "Why is human-in-the-loop important for CV writing?",
    answer:
      "Because your CV is personal, high-stakes, and should reflect your real background accurately. Fully automatic AI rewriting may sound convenient, but it can lead to weak, generic, or misleading results. Human-in-the-loop means the AI helps with speed and structure, while you guide relevance, truthfulness, and emphasis. That balance is a major reason users can trust the output more.",
  },
  {
    question: "What is ATS, and does this help with it?",
    answer:
      "ATS stands for Applicant Tracking System — the software many employers use to collect, scan, and sort job applications before a recruiter ever reviews them. A well-structured, relevant CV is more likely to perform better in these systems. And yes, the product helps with exactly this. It surfaces relevant language, topics, and keywords from the job description so your CV is more aligned with the role — but it does so in a controlled way, keeping the CV readable, credible, and useful for both ATS screening and human recruiters.",
  },
];

export function categoryPath(category) {
  return `/career-advice/${category.slug}`;
}

export function articlePath(article) {
  return `/career-advice/${article.categorySlug}/${article.slug}`;
}

function categoryForArticle(content, article) {
  return content.categories.find((category) => category.slug === article.categorySlug);
}

function latestCategoryUpdatedDate(content, category) {
  const dates = content.articles
    .filter((article) => article.categorySlug === category.slug)
    .map((article) => article.updatedDate)
    .filter(Boolean)
    .sort();

  return dates[dates.length - 1] || "2026-06-17";
}

function categoryRoute(content, category) {
  const path = categoryPath(category);
  return {
    path,
    snapshot: `career-advice-${category.slug}`,
    title: `${category.name} | jobspecificCV Career Advice`,
    description: category.description,
    canonical: absoluteUrl(path),
    ogType: "website",
    ogTitle: category.name,
    ogDescription: category.description,
    ogImage: OG_IMAGE,
    ogImageAlt: `${category.name} - jobspecificCV career advice`,
    twitterTitle: category.name,
    twitterDescription: category.description,
    twitterImage: OG_IMAGE,
    twitterImageAlt: `${category.name} - jobspecificCV career advice`,
    lastmod: latestCategoryUpdatedDate(content, category),
    includeInSitemap: true,
    changefreq: "weekly",
    priority: "0.7",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: category.name,
        description: category.description,
        url: absoluteUrl(path),
      },
      breadcrumbJsonLd([
        { name: "Home", path: "/" },
        { name: "Career advice", path: "/career-advice" },
        { name: category.name, path },
      ]),
    ],
  };
}

function articleRoute(content, article) {
  const category = categoryForArticle(content, article);
  const path = articlePath(article);
  const hasBody = Array.isArray(article.body) && article.body.length > 0;
  return {
    path,
    snapshot: `career-advice-${article.categorySlug}-${article.slug}`,
    title: `${article.title} | jobspecificCV`,
    description: article.description,
    canonical: absoluteUrl(path),
    robots: hasBody ? "index, follow" : "noindex, follow",
    ogType: "article",
    ogTitle: article.title,
    ogDescription: article.description,
    ogImage: article.heroImage || OG_IMAGE,
    ogImageAlt: article.title,
    twitterTitle: article.title,
    twitterDescription: article.description,
    twitterImage: article.heroImage || OG_IMAGE,
    twitterImageAlt: article.title,
    lastmod: article.updatedDate,
    includeInSitemap: hasBody,
    changefreq: "monthly",
    priority: "0.8",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: article.title,
        description: article.description,
        image: article.heroImage || OG_IMAGE,
        datePublished: article.publishedDate,
        dateModified: article.updatedDate,
        author: {
          "@type": "Organization",
          name: SITE_NAME,
          url: SITE_URL,
        },
        publisher: {
          "@type": "Organization",
          name: SITE_NAME,
          logo: {
            "@type": "ImageObject",
            url: `${SITE_URL}/images/logo.png`,
          },
        },
        mainEntityOfPage: {
          "@type": "WebPage",
          "@id": absoluteUrl(path),
        },
      },
      breadcrumbJsonLd([
        { name: "Home", path: "/" },
        { name: "Career advice", path: "/career-advice" },
        ...(category ? [{ name: category.name, path: categoryPath(category) }] : []),
        { name: article.title, path },
      ]),
    ],
  };
}

// All indexable routes. `snapshot` is the filename (without .html) inside
// frontend/prerendered/. `content` is the parsed career-advice-content.json.
export function buildSeoRoutes(content) {
  return [
    {
      path: "/",
      snapshot: "landing",
      title: "Tailor Your CV to Any Job Description in Minutes | jobspecificCV",
      description:
        "Upload your CV, paste a job description, and create a cleaner, ATS-friendly CV focused on the role in front of you.",
      canonical: absoluteUrl("/"),
      ogType: "website",
      ogTitle: "Tailor Your CV to Any Job Description in Minutes",
      ogDescription:
        "Upload your CV, paste a job description, and export an ATS-friendly version focused on the role.",
      ogImage: OG_IMAGE,
      twitterTitle: "Tailor Your CV to Any Job Description in Minutes",
      twitterDescription: "Create an ATS-friendly CV tailored to a specific job description.",
      twitterImage: OG_IMAGE,
      lastmod: "2026-06-30",
      includeInSitemap: true,
      changefreq: "weekly",
      priority: "1.0",
      jsonLd: [
        WEB_APPLICATION_JSON_LD,
        ORGANIZATION_JSON_LD,
        faqPageJsonLd(LANDING_FAQ_ITEMS),
      ],
    },
    {
      path: "/pricing",
      snapshot: "pricing",
      title: "Pricing | jobspecificCV",
      description:
        "Simple pricing for a faster job search. Start free, go Monthly Pro with a 3-day free trial, or pay once for Lifetime Pro. Cancel anytime.",
      canonical: absoluteUrl("/pricing"),
      ogType: "website",
      ogTitle: "jobspecificCV Pricing — Free, Monthly Pro, and Lifetime",
      ogDescription:
        "Start free, go Pro with a 3-day free trial, or buy Lifetime Pro once. No charge during the trial; cancel anytime.",
      ogImage: OG_IMAGE,
      ogImageAlt: DEFAULT_IMAGE_ALT,
      twitterTitle: "jobspecificCV Pricing",
      twitterDescription:
        "Start free, go Pro with a 3-day free trial, or buy Lifetime Pro once. Cancel anytime.",
      twitterImage: OG_IMAGE,
      twitterImageAlt: DEFAULT_IMAGE_ALT,
      lastmod: "2026-05-31",
      includeInSitemap: true,
      changefreq: "monthly",
      priority: "0.9",
      jsonLd: [
        WEB_APPLICATION_JSON_LD,
        breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Pricing", path: "/pricing" },
        ]),
      ],
    },
    {
      path: "/career-advice",
      snapshot: "career-advice",
      title: "CV Advice for Getting More Interviews | jobspecificCV",
      description:
        "Read practical CV guides for tailoring your CV to job descriptions, improving ATS readability, and building stronger medical and NHS applications.",
      canonical: absoluteUrl("/career-advice"),
      ogType: "website",
      ogTitle: "CV Advice for Getting More Interviews",
      ogDescription:
        "Practical CV guides for ATS, job descriptions, NHS applications, and stronger interview-focused resumes.",
      ogImage: OG_IMAGE,
      twitterTitle: "CV Advice for Getting More Interviews",
      twitterDescription:
        "Practical CV guides for ATS, job descriptions, NHS applications, and stronger interview-focused resumes.",
      twitterImage: OG_IMAGE,
      lastmod: "2026-06-30",
      includeInSitemap: true,
      changefreq: "weekly",
      priority: "0.8",
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "CV Advice for Getting More Interviews",
          description:
            "Guides for tailoring CVs to job descriptions, improving ATS readability, and building stronger medical and NHS applications.",
          url: absoluteUrl("/career-advice"),
        },
        breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Career advice", path: "/career-advice" },
        ]),
      ],
    },
    ...content.categories.map((category) => categoryRoute(content, category)),
    ...content.articles.map((article) => articleRoute(content, article)),
  ];
}

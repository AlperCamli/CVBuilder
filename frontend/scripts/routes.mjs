import { readFileSync } from "node:fs";

const SITE_URL = "https://jobspecificcv.com";
const OG_IMAGE = `${SITE_URL}/images/og-image.png`;

const content = JSON.parse(
  readFileSync(new URL("../src/content/career-advice-content.json", import.meta.url), "utf8")
);
const categories = content.categories;
const articles = content.articles;

function absoluteUrl(path) {
  return `${SITE_URL}${path}`;
}

function breadcrumbJsonLd(items) {
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

function categoryPath(category) {
  return `/career-advice/${category.slug}`;
}

function articlePath(article) {
  return `/career-advice/${article.categorySlug}/${article.slug}`;
}

function categoryForArticle(article) {
  return categories.find((category) => category.slug === article.categorySlug);
}

function categoryRoute(category) {
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
    twitterTitle: category.name,
    twitterDescription: category.description,
    twitterImage: OG_IMAGE,
    lastmod: "2026-05-26",
    includeInSitemap: true,
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

function articleRoute(article) {
  const category = categoryForArticle(article);
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
    twitterTitle: article.title,
    twitterDescription: article.description,
    twitterImage: article.heroImage || OG_IMAGE,
    lastmod: article.updatedDate,
    includeInSitemap: hasBody,
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
          name: "jobspecificCV",
          url: SITE_URL,
        },
        publisher: {
          "@type": "Organization",
          name: "jobspecificCV",
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

// Routes to prerender. Add route objects here to prerender more pages.
// `snapshot` is the filename (without .html) inside frontend/prerendered/.
export const ROUTES = [
  {
    path: "/",
    snapshot: "landing",
    title: "jobspecificCV | AI CV Builder for Job-Specific Resumes",
    description:
      "Create ATS-friendly CVs tailored to each job description. Upload your CV, match the role's keywords, and export a polished job-specific resume in minutes.",
    canonical: absoluteUrl("/"),
    ogType: "website",
    ogTitle: "jobspecificCV | AI CV Builder for Job-Specific Resumes",
    ogDescription:
      "Build one CV, customize it for every job, and export an ATS-friendly PDF tuned to the role.",
    ogImage: OG_IMAGE,
    twitterTitle: "jobspecificCV | AI CV Builder for Job-Specific Resumes",
    twitterDescription: "Create ATS-friendly CVs tailored to each job description in minutes.",
    twitterImage: OG_IMAGE,
    lastmod: "2026-05-26",
    includeInSitemap: true,
  },
  {
    path: "/career-advice",
    snapshot: "career-advice",
    title: "Career Advice for CVs and Job Applications | jobspecificCV",
    description:
      "Read practical guides on creating a clear CV, tailoring it to job descriptions, and improving every job application.",
    canonical: absoluteUrl("/career-advice"),
    ogType: "website",
    ogTitle: "Career Advice for CVs and Job Applications",
    ogDescription:
      "Practical guides for building better CVs and tailoring them to specific jobs.",
    ogImage: OG_IMAGE,
    twitterTitle: "Career Advice for CVs and Job Applications",
    twitterDescription:
      "Practical guides for building better CVs and tailoring them to specific jobs.",
    twitterImage: OG_IMAGE,
    lastmod: "2026-05-26",
    includeInSitemap: true,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Career Advice",
        description:
          "Guides for creating a clear CV, tailoring it to job descriptions, and improving job applications.",
        url: absoluteUrl("/career-advice"),
      },
      breadcrumbJsonLd([
        { name: "Home", path: "/" },
        { name: "Career advice", path: "/career-advice" },
      ]),
    ],
  },
  ...categories.map(categoryRoute),
  ...articles.map(articleRoute),
];

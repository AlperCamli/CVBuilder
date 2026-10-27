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
    "An AI-assisted CV builder for creating ATS-friendly CVs tailored to specific job descriptions from a master CV in your chosen language.",
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

};

// Shared with the visible guided page so its structured FAQ cannot drift.
export const GUIDED_JOURNEY_FAQ_ITEMS = [
  {
    question: "Can I look around before adding a card?",
    answer: "Yes. You can answer a few quick questions and see your CV take shape without entering any card details. When you’re ready to create, tailor and download, start your 3-day free trial: you add a card at secure Stripe checkout, pay nothing today and can cancel anytime. If you don’t cancel before the trial ends, Weekly Pro renews weekly at the price shown. Already have an account? You can always view and edit your saved CVs for free.",
  },
  {
    question: "Why do you ask for a card for the free trial?",
    answer: "It keeps the trial fair for everyone and lets you carry on with Pro without interruption if you love it. You won’t be charged during the 3 days, and payments are handled securely by Stripe — we never see or store your card number. Cancel from your account before the trial ends and you won’t pay anything. The trial is for Weekly Pro and eligible users; checkout confirms your eligibility and terms.",
  },
  {
    question: "Can I review the changes?",
    answer: "Always. You choose the keywords that fit, review every suggestion and edit your CV before you download it. Your real experience always comes first.",
  },
];

export const GUIDED_JOURNEY_FAQ_ITEMS_TR = [
  { question: "Kart eklemeden önce uygulamayı tanıyabilir miyim?", answer: "Elbette. Birkaç kısa soruyu yanıtlayıp kart bilgisi girmeden CV’nin şekillendiğini görebilirsin. CV oluşturmaya, uyarlamaya ve indirmeye hazır olduğunda 3 günlük ücretsiz denemeni başlat: kartını güvenli Stripe ödeme sayfasında eklersin, bugün hiçbir ödeme yapmazsın ve istediğin zaman iptal edebilirsin. Deneme bitmeden iptal etmezsen Haftalık Pro, gösterilen fiyatla haftalık olarak yenilenir. Zaten hesabın var mı? Kayıtlı CV’lerini her zaman ücretsiz görüntüleyip düzenleyebilirsin." },
  { question: "Ücretsiz deneme için neden kart istiyorsunuz?", answer: "Böylece deneme herkes için adil kalıyor ve Pro’yu sevdiysen hiç ara vermeden devam edebiliyorsun. 3 gün boyunca senden ücret alınmaz. Ödemeler Stripe tarafından güvenle işlenir; kart numaranı biz hiçbir zaman görmeyiz ve saklamayız. Deneme bitmeden hesabından iptal edersen hiçbir ödeme yapmazsın. Deneme, Haftalık Pro’da ve uygun kullanıcılar için geçerlidir; uygunluk ve koşullar ödeme sayfasında netleşir." },
  { question: "Değişiklikleri inceleyebilir miyim?", answer: "Her zaman. Sana uyan anahtar kelimeleri sen seçersin, her öneriyi incelersin ve indirmeden önce CV’ni düzenlersin. Gerçek deneyimin her zaman önce gelir." }
];

function guidedJourneyRoute(pricing, locale = "en", primary = false) {
  const path = primary ? (locale === "tr" ? (pricing ? "/tr/pricing" : "/tr") : (pricing ? "/pricing" : "/")) : (pricing ? "/guided-journey/pricing" : "/guided-journey");
  const title = locale === "tr" ? (pricing ? "Fiyatlandırma | jobspecificCV" : "İşe Özel CV’ni Dakikalar İçinde Hazırla | jobspecificCV") : pricing
    ? "Guided Journey Pricing | jobspecificCV"
    : "Tailor Your CV in Minutes — Guided Journey | jobspecificCV";
  const description = locale === "tr" ? (pricing ? "3 günlük ücretsiz denemeyle başlayın veya Haftalık, Aylık ve Yıllık Pro planlarını karşılaştırın. Bölgenize uygun fiyatları görün." : "CV’ni yükle, iş ilanına göre uyarla ve her değişikliği kendin incele. Türkçe veya İngilizce CV’ni dakikalar içinde hazırla.") : pricing
    ? "Compare Weekly, Monthly and Annual Pro with prices for your region. Try Weekly Pro free for 3 days, or choose a plan that fits your job search."
    : "Try the interactive CV demo with a friendly guide. Tailor your CV to any job, review every change, and try it free for 3 days.";
  return {
    path,
    language: locale,
    alternates: primary ? { en: absoluteUrl(pricing ? "/pricing" : "/"), tr: absoluteUrl(pricing ? "/tr/pricing" : "/tr"), "x-default": absoluteUrl(pricing ? "/pricing" : "/") } : undefined,
    snapshot: primary ? `${locale}-${pricing ? "pricing" : "landing"}` : pricing ? "guided-journey-pricing" : "guided-journey",
    clientEntry: "src/app/pages/GuidedJourneyPage.tsx",
    title,
    description,
    canonical: absoluteUrl(path),
    // The existing homepage and pricing remain the primary indexed pages.
    robots: primary ? "index, follow" : "noindex, follow",
    ogType: "website",
    ogTitle: title,
    ogDescription: description,
    ogImage: OG_IMAGE,
    ogImageAlt: DEFAULT_IMAGE_ALT,
    twitterTitle: title,
    twitterDescription: description,
    twitterImage: OG_IMAGE,
    twitterImageAlt: DEFAULT_IMAGE_ALT,
    lastmod: "2026-10-12",
    includeInSitemap: primary,
    changefreq: "monthly",
    priority: "0.7",
    jsonLd: [
      WEB_APPLICATION_JSON_LD,
      faqPageJsonLd(locale === "tr" ? GUIDED_JOURNEY_FAQ_ITEMS_TR : GUIDED_JOURNEY_FAQ_ITEMS),
      breadcrumbJsonLd([
        { name: "Home", path: "/" },
        { name: "Guided Journey", path: "/guided-journey" },
        ...(pricing ? [{ name: "Pricing", path }] : []),
      ]),
    ],
  };
}

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
  const displayName = category.h1 || category.name;
  const categoryArticles = content.articles.filter(
    (article) => article.categorySlug === category.slug
  );
  return {
    path,
    snapshot: `career-advice-${category.slug}`,
    title: category.seoTitle || `${category.name} | jobspecificCV Career Advice`,
    description: category.description,
    canonical: absoluteUrl(path),
    ogType: "website",
    ogTitle: displayName,
    ogDescription: category.description,
    ogImage: OG_IMAGE,
    ogImageAlt: `${displayName} - jobspecificCV career advice`,
    twitterTitle: displayName,
    twitterDescription: category.description,
    twitterImage: OG_IMAGE,
    twitterImageAlt: `${displayName} - jobspecificCV career advice`,
    lastmod: latestCategoryUpdatedDate(content, category),
    includeInSitemap: true,
    changefreq: "weekly",
    priority: "0.7",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: displayName,
        description: category.description,
        url: absoluteUrl(path),
        mainEntity: {
          "@type": "ItemList",
          itemListElement: categoryArticles.map((article, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: article.title,
            url: absoluteUrl(articlePath(article)),
          })),
        },
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
  const faqItems = (article.body || [])
    .filter((block) => block.type === "faq")
    .flatMap((block) => block.items);
  return {
    path,
    snapshot: `career-advice-${article.categorySlug}-${article.slug}`,
    title: article.seoTitle || `${article.title} | jobspecificCV`,
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
      ...(faqItems.length > 0 ? [faqPageJsonLd(faqItems)] : []),
    ],
  };
}

// All prerendered routes, including noindexed previews. `snapshot` is the filename inside
// frontend/prerendered/. `content` is the parsed career-advice-content.json.
export function buildSeoRoutes(content) {
  return [
    ...["en", "tr"].map(language => {
      const tr = language === "tr";
      const path = tr ? "/tr/support" : "/support";
      return {
        path, language, snapshot: `${language}-support`,
        title: tr ? "Destek ve İletişim | jobspecificCV" : "Support & Contact | jobspecificCV",
        description: tr ? "CV yükleme, dışa aktarma, ücretsiz deneme ve abonelik hakkında yardım alın. JobSpecificCV destek ekibine e-posta ile ulaşın." : "Get help with CV uploads, exports, your free trial, and subscriptions. Contact JobSpecificCV support by email.",
        canonical: absoluteUrl(path), robots: "index, follow", ogType: "website",
        ogImage: OG_IMAGE, includeInSitemap: true,
        alternates: { en: absoluteUrl("/support"), tr: absoluteUrl("/tr/support"), "x-default": absoluteUrl("/support") }
      };
    }),
    guidedJourneyRoute(false, "en", true),
    guidedJourneyRoute(true, "en", true),
    guidedJourneyRoute(false, "tr", true),
    guidedJourneyRoute(true, "tr", true),
    guidedJourneyRoute(false),
    guidedJourneyRoute(true),
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
          mainEntity: {
            "@type": "ItemList",
            itemListElement: content.categories.map((category, index) => ({
              "@type": "ListItem",
              position: index + 1,
              name: category.name,
              url: absoluteUrl(categoryPath(category)),
            })),
          },
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

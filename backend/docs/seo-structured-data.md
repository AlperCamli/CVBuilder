# SEO & Structured Data — What's Done and What You Need to Provide

This doc tracks the SEO improvements made to [frontend/index.html](../../frontend/index.html) and lists information **you need to supply** to unlock the remaining enhancements.

---

## ✅ Already Implemented

### 1. Open Graph image + Twitter `summary_large_image` card
- Wired up `/images/og-image.png` as `og:image` and `twitter:image`
- Switched Twitter card type from `summary` → `summary_large_image` so the full 1200×630 image renders in feeds instead of a tiny thumbnail
- Added `og:locale`, image dimensions, and alt text

### 2. Enriched JSON-LD `WebApplication` schema
- Added `featureList` — helps Google + LLM crawlers (ChatGPT, Perplexity, Claude search) understand what the product does
- Added `offers` array with all three plans (Free $0, Pro $10/mo, Lifetime $99) — eligible for "Free" / "From $X" badges in Google SERPs

**Verify:** paste your URL into [Google's Rich Results Test](https://search.google.com/test/rich-results) after deploying.

### 3. Public career-advice pages + route-specific prerender metadata
- Added unsigned public routes for `/career-advice` and initial article pages
- Extended prerender route configuration so public pages can receive unique titles, descriptions, canonicals, Open Graph/Twitter tags, and JSON-LD
- Added `BlogPosting` schema for article pages and `BreadcrumbList` schema for the career-advice hierarchy
- Added the career-advice hub and articles to `sitemap.xml`

---

## 📝 What You Need to Provide

The items below are **optional but high-impact** SEO additions. Each requires information only you can give. Reply with the data and I'll wire it up.

### A) Organization Schema → Knowledge Panel eligibility

**What it does:** Tells Google "jobspecificCV is a real entity, here's its logo, here are its official social profiles." Over time this builds a Knowledge Panel (the box that appears on the right of Google when you search a brand). It also links your social presence to your domain, which is a trust signal.

**Why it matters:**
- LLM search engines (ChatGPT, Perplexity) cite this when recommending your product
- Disambiguates your brand from similarly-named tools
- Required for verified social badge displays in some SERPs

**What I need from you:**

```yaml
logo_url: https://jobspecificcv.com/images/logo.png   # absolute URL to your logo (PNG/SVG, ideally 112×112+ square)
legal_name: ""                                         # e.g. "JobSpecificCV LLC" or your company's legal name (leave blank if just a brand name)
founding_date: "2024-XX"                               # YYYY-MM when the product launched
contact_email: "support@jobspecificcv.com"             # public support/contact email
social_profiles:
  - https://twitter.com/yourhandle                     # X/Twitter URL (or leave out if none)
  - https://www.linkedin.com/company/yourcompany       # LinkedIn company page
  - https://www.instagram.com/yourhandle               # Instagram
  - https://www.tiktok.com/@yourhandle                 # TikTok
  - https://www.youtube.com/@yourhandle                # YouTube
  # only include profiles you actually own and that are active
```

---

### B) FAQ Page Schema → Expandable Q&A in search results

**What it does:** Lets Google display 3-5 of your FAQs as expandable accordions directly under your search result. Triples the vertical space your listing occupies in SERPs and answers user questions before they even click — huge for capturing high-intent traffic.

**Requirements:**
- The FAQs must be **visible on the page** (not hidden behind tabs you only show to crawlers)
- Questions must be questions real users ask (Google has cracked down on keyword-stuffed FAQs)
- Currently your [Landing.tsx](../../frontend/src/app/pages/Landing.tsx) has no FAQ section — you'd need to add one

**What I need from you:**

```yaml
# 5-8 FAQs is the sweet spot. Each answer should be 2-3 sentences.
faqs:
  - question: "How does jobspecificCV tailor my resume to a job?"
    answer: "You upload your master CV once, paste the job description, and our AI rewrites your bullets and reorders sections to match the role's keywords and required skills. You get a polished, ATS-friendly PDF in under a minute."

  - question: "Is my CV data private?"
    answer: "Yes — your CV data is encrypted at rest and we never share it with third parties. We don't use your CV content to train AI models."

  - question: "Will my tailored CV pass ATS scanners?"
    answer: "Yes. Every template is built to be parsed correctly by Applicant Tracking Systems like Workday, Greenhouse, and Lever. We use standard fonts, no images or tables, and clean section headers."

  - question: "How much does it cost?"
    answer: "There's a free plan to try the product. Pro is $10/month with a 3-day free trial, and we offer a one-time Lifetime plan for $99."

  - question: "Can I cancel my Pro subscription anytime?"
    answer: "Yes — cancel anytime from your account settings. If you cancel during the 3-day trial, you won't be charged."

  - question: "What file formats can I export?"
    answer: "PDF, optimized for both ATS parsing and human readers. Every export uses standard fonts and a single-column layout for maximum ATS compatibility."

  # add 2-3 more relevant questions you commonly get
```

Once you have these, two steps:
1. Add a visible FAQ accordion section to [Landing.tsx](../../frontend/src/app/pages/Landing.tsx)
2. I'll add the matching `FAQPage` JSON-LD block to [index.html](../../frontend/index.html)

⚠️ **Note:** As of August 2023, Google reduced FAQ rich-result visibility — they now mostly only show for "well-known authoritative government and health websites." So this is a longer-term play. Still worth doing because:
- LLM search engines (ChatGPT, Perplexity, Claude search) still parse and use this aggressively
- Bing still shows FAQ snippets prominently
- It's structured content that helps your overall topical authority

---

### C) BreadcrumbList Schema (later, when you have more pages)

**What it does:** Shows your site's hierarchy under the URL in search results (e.g., `Home › Pricing › Pro Plan`). Visual SERP enhancement.

**When to add:** Once you have deep pages worth ranking individually (e.g., blog posts, template-specific landing pages, location-specific pages like `/resume-builder-uk`). Skip for now.

---

### D) Article/BlogPosting Schema (when you start blogging)

**What it does:** Required if you launch a blog and want posts to appear in Google Discover, "Top Stories," and as rich results with author/date.

**When to add:** When you create your first blog post. Will require:
- Author name + bio + photo URL
- Article publish date + last-modified date
- Article hero image (1200×630 minimum)
- Article body in semantic HTML

---

## 🔧 Other SEO Improvements Worth Considering

These don't require info from you but are worth tracking:

| Item | Status | Notes |
|---|---|---|
| Favicon | 🟡 You're handling | Confirm `.ico`, `.svg`, and `apple-touch-icon.png` all referenced |
| `robots.txt` | ✅ Done | Configured at [frontend/public/robots.txt](../../frontend/public/robots.txt) |
| `sitemap.xml` | ✅ Done | Configured + submitted to Search Console |
| Pre-rendering / SSR | ✅ Partial prerendering | Landing page and public career-advice pages are prerendered; authenticated app remains client-only and noindexed |
| OG image file size | 🟡 1.6MB → could compress to ~400KB | Faster preview rendering on mobile |
| Core Web Vitals audit | ⏳ TODO | Run [PageSpeed Insights](https://pagespeed.web.dev/) on production URL |
| Internal linking strategy | ⏳ TODO | Once you have blog/feature pages |
| `hreflang` tags | ❌ Not needed | Only if you launch non-English versions |

---

## Validation Checklist (after any change)

After implementing any of the above and deploying:

1. **Rich Results Test:** https://search.google.com/test/rich-results — paste URL, confirm no errors
2. **Schema Markup Validator:** https://validator.schema.org/ — alternative validator
3. **Social previews:** https://www.opengraph.xyz/ — paste URL, see how Twitter, LinkedIn, Discord, iMessage all render the share card
4. **LinkedIn-specific:** https://www.linkedin.com/post-inspector/ — LinkedIn caches aggressively, use this to force a re-scrape
5. **Google Search Console:** Inspect URL → request re-indexing after schema changes

---

## Summary of next action

When you're ready to add the Organization schema (the highest-impact item that needs your input), reply with the `logo_url`, `legal_name`, and `social_profiles` block from section A and I'll implement it.

For FAQ schema, the prerequisite is adding a visible FAQ section to the landing page — let me know when you're ready and I can draft the section and the schema together.

For blog growth, add new article entries to `frontend/src/content/career-advice-content.json`, regenerate prerender snapshots with `npm run build`, and add the URL to `frontend/public/sitemap.xml` once the article body is no longer empty. Article prerender routes and route-level metadata are derived from the content JSON; empty draft articles are prerendered but marked `noindex, follow`.

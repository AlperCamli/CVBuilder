# Blog Pages & Career Advice SEO Workflow

This app uses static, typed frontend content for public blog pages. The pages are React routes, but they are also prerendered into HTML so crawlers can read the page content without running the full app.

## Public URL Structure

All blog content currently lives under the public `career-advice` hub:

```text
/career-advice
/career-advice/:categorySlug
/career-advice/:categorySlug/:articleSlug
```

Current categories:

| Full category name | Navigation label | URL slug |
|---|---|---|
| Resume / CV Basics | Basics | `resume-cv-basics` |
| Job-Specific CV Tailoring | Tailoring | `job-specific-cv-tailoring` |
| ATS-Friendly Resume Optimization | ATS | `ats-friendly-resume-optimization` |
| Examples, Templates & Checklists | Templates | `examples-templates-checklists` |

The short navigation labels keep the sticky nav compact. The full names are still used in headings, cards, breadcrumbs, and SEO metadata.

## Content Source

Blog data lives in:

```text
frontend/src/content/career-advice-content.json
```

The file has two top-level arrays:

```json
{
  "categories": [],
  "articles": []
}
```

Categories define topic hubs:

```json
{
  "slug": "ats-friendly-resume-optimization",
  "name": "ATS-Friendly Resume Optimization",
  "navLabel": "ATS",
  "description": "Practical advice for formatting, keywords, and structure that applicant tracking systems can parse."
}
```

Articles define individual pages:

```json
{
  "slug": "resume-keywords-for-ats",
  "title": "Resume Keywords for ATS: How to Use Them Without Keyword Stuffing",
  "description": "A concise meta-style summary of the article.",
  "categorySlug": "ats-friendly-resume-optimization",
  "priorityRule": "Very High",
  "publishedDate": "2026-05-26",
  "updatedDate": "2026-05-26",
  "readingTime": "Draft",
  "heroImage": "https://jobspecificcv.com/images/og-image.png",
  "body": []
}
```

The TypeScript helpers in `frontend/src/content/career-advice.ts` derive article paths, category paths, and category display names from this JSON. Prefer updating the JSON first instead of hardcoding page lists in components.

## Adding a New Category

1. Add a new object to `categories`.
2. Pick a short, stable `slug`; use lowercase words separated by hyphens.
3. Add a compact `navLabel` if it should appear in the sticky navigation.
4. Add at least one article with a matching `categorySlug`.
5. Add the category URL to `frontend/public/sitemap.xml` if the category page has useful visible content.
6. Run the build commands below to regenerate prerendered output.

Keep category descriptions plain and specific. They are used on visible pages and route-level metadata.

## Adding a New Article

1. Add an article object to `articles`.
2. Use a stable, keyword-readable `slug`.
3. Set `categorySlug` to an existing category slug.
4. Fill in SEO fields:
   - `title`: full article title and eventual `<h1>`
   - `description`: meta description and card summary
   - `publishedDate`: first publish date, `YYYY-MM-DD`
   - `updatedDate`: last meaningful content update, `YYYY-MM-DD`
   - `readingTime`: visible reading time after content is added
   - `heroImage`: absolute image URL for Open Graph/Twitter/article schema
5. Add structured body blocks when content is ready:

```json
"body": [
  {
    "type": "paragraph",
    "text": "Intro paragraph."
  },
  {
    "type": "heading",
    "text": "Section heading"
  },
  {
    "type": "list",
    "items": [
      "Checklist item",
      "Another checklist item"
    ]
  }
]
```

Empty `body: []` means the page is a draft placeholder.

## Draft vs Indexable Articles

Draft article pages are still prerendered so internal links and previews work. They are intentionally marked:

```html
<meta name="robots" content="noindex, follow" />
```

Draft articles are also excluded from `frontend/public/sitemap.xml`.

When an article has real body content:

1. Add the body blocks.
2. Update `readingTime`, `publishedDate`, and `updatedDate`.
3. Confirm the build output changes the route to `index, follow`.
4. Add the article URL to `frontend/public/sitemap.xml`.

This avoids asking search engines to index thin placeholder pages.

## Prerendering

The prerender route list is generated in:

```text
frontend/scripts/routes.mjs
```

That script reads `career-advice-content.json` and creates route metadata for:

- `/`
- `/career-advice`
- every category page
- every article page

Local production build:

```bash
cd frontend
npm run build
```

This runs Vite, launches Puppeteer, captures each route, writes snapshots to `frontend/prerendered/`, and patches `frontend/dist/.../index.html`.

Vercel build:

```bash
cd frontend
npm run vercel-build
```

This runs Vite and injects existing `frontend/prerendered/*.html` snapshots into `dist`. If a route is added but its snapshot is missing, the Vercel build fails. Run `npm run build` locally after adding or changing blog routes.

## SEO Metadata

Route-level metadata is assembled in `frontend/scripts/routes.mjs` and injected by:

```text
frontend/scripts/seo-html.mjs
```

For article pages, the generated metadata includes:

- `<title>`
- meta description
- canonical URL
- robots tag
- Open Graph title, description, URL, image, and type
- Twitter title, description, and image
- `BlogPosting` JSON-LD
- `BreadcrumbList` JSON-LD

For category pages, the generated metadata includes:

- `<title>`
- meta description
- canonical URL
- Open Graph/Twitter metadata
- `CollectionPage` JSON-LD
- `BreadcrumbList` JSON-LD

To improve SEO performance for a finished article:

- Use a clear title that matches search intent.
- Keep the slug short and readable.
- Write a unique description around 140-160 characters when possible.
- Use one primary topic per article.
- Add useful subheadings in body blocks.
- Prefer specific examples, checklists, and actionable steps.
- Update `updatedDate` only after meaningful content changes.
- Use a 1200x630 hero image when possible for social previews.
- Add the final URL to `sitemap.xml` only after the article has real content.

## Validation Checklist

After adding or updating blog content:

1. Run `npm run build` from `frontend`.
2. Run `npm run vercel-build` from `frontend`.
3. Run `npm run test` from `frontend`.
4. Inspect the generated HTML under `frontend/dist/career-advice/.../index.html`.
5. Confirm finished articles have `index, follow`.
6. Confirm draft articles have `noindex, follow`.
7. Confirm `frontend/public/sitemap.xml` contains only indexable public pages.
8. After deployment, validate important URLs with Google Rich Results Test and Search Console URL Inspection.

## Article Hero Images

Each article has its own hero image. The same image powers two surfaces:

- The visible cover at the top of the article page (rendered by `frontend/src/app/pages/CareerArticle.tsx`).
- The Open Graph / Twitter / `BlogPosting` JSON-LD image emitted by `frontend/scripts/routes.mjs`.

### Field shape

`heroImage` is stored as an absolute URL on `jobspecificcv.com`:

```json
"heroImage": "https://jobspecificcv.com/images/cover-cv-vs-resume.png"
```

The absolute URL is required for social metadata. The article page strips the protocol and host at render time so the same value resolves to a local path in development:

```tsx
<img
  src={article.heroImage.replace(/^https?:\/\/[^/]+/, "") || "/images/og-image.png"}
  alt=""
  className="w-full h-full object-cover"
/>
```

If `heroImage` is empty, the renderer falls back to `/images/og-image.png`. The fallback does not cover the case where the file is missing on disk; a wrong filename will 404 in the browser and on social previews.

### File location and naming

Hero images live in:

```text
frontend/public/images/
```

Naming convention: `cover-<short-topic>.png`, lowercase, hyphen-separated. Short topical names are preferred over the full slug so file names stay easy to type.

### Recommended dimensions

Use **1200x630 PNG**. That matches Open Graph / Twitter Card expectations and crops cleanly to the 16:9 frame on the article page (`object-cover`).

### Adding or changing a hero image

1. Drop the PNG into `frontend/public/images/` using the agreed `cover-...` filename.
2. Update the article's `heroImage` in `career-advice-content.json` to the matching absolute URL: `https://jobspecificcv.com/images/<filename>.png`.
3. Run `npm run build` from `frontend` to regenerate prerendered HTML and refresh OG/JSON-LD metadata.
4. Confirm the article page renders the new image and that the generated HTML's `og:image`, `twitter:image`, and `BlogPosting` `image` all point to the new URL.

### Current article to image map

| Article slug | Hero image filename |
|---|---|
| `how-to-write-a-resume-that-gets-interviews` | `cover-write-resume.png` |
| `cv-vs-resume-whats-the-difference` | `cover-cv-vs-resume.png` |
| `how-to-tailor-your-resume-to-a-job-description` | `cover-tailor-resume.png` |
| `how-to-customize-your-cv-for-every-job-in-minutes` | `cover-customize-cv.png` |
| `job-specific-resume-why-one-generic-cv-is-not-enough` | `cover-job-specific-resume.png` |
| `what-is-an-ats-resume` | `cover-what-is-ats.png` |
| `ats-friendly-resume-format` | `cover-ats-friendly-format.png` |
| `resume-keywords-for-ats` | `cover-resume-keywords.png` |
| `resume-checklist-25-things-to-fix-before-you-apply` | `cover-resume-checklist.png` |
| `ats-resume-template-simple-structure` | `cover-ats-template.png` |
| `before-and-after-resume-examples-generic-cv-vs-tailored-cv` | `cover-before-after.png` |

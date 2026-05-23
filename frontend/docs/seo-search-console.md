# SEO and Google Search Console Setup

Production domain: `https://jobspecificcv.com/`

## What is already configured

- Landing page title, meta description, canonical URL, Open Graph tags, Twitter card tags, and `WebApplication` structured data in `index.html`.
- Public sitemap at `https://jobspecificcv.com/sitemap.xml`.
- Robots file at `https://jobspecificcv.com/robots.txt`.
- `X-Robots-Tag: noindex, nofollow` headers for authenticated and utility routes in `vercel.json`.

## Google Search Console

Recommended setup:

1. Add a Domain property for `jobspecificcv.com` in Google Search Console.
2. Verify it with the DNS TXT record Google provides through your DNS provider.
3. Add the sitemap URL: `https://jobspecificcv.com/sitemap.xml`.
4. Use URL Inspection for `https://jobspecificcv.com/` and request indexing after the latest deployment is live.

Alternative HTML tag setup:

1. Add a URL-prefix property for `https://jobspecificcv.com/`.
2. Copy the exact meta tag Google provides.
3. Paste it inside the `<head>` of `index.html`.
4. Deploy, then verify in Search Console.

Example only. Do not use this placeholder:

```html
<meta name="google-site-verification" content="PASTE_GOOGLE_TOKEN_HERE" />
```

## SEO backlog

- Add a real social preview image and reference it with `og:image` and `twitter:image`.
- Add public content pages when ready, for example `/ats-cv-builder`, `/job-specific-cv`, or educational guides. A single-page app can rank, but more useful indexable pages give Google more relevant content to evaluate.
- Add testimonials, examples, pricing, FAQ, or trust content to the public landing page when the product positioning is finalized.
- Add analytics only after cookie/privacy requirements are clear for your target markets.

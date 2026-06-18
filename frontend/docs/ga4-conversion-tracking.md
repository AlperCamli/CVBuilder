# GA4 Conversion Tracking

The frontend initializes GA4 only when `VITE_GA_MEASUREMENT_ID` is set.

## Funnel Events

| Event | Meaning | Fired from |
|---|---|---|
| `blog_cta_click` | User clicked a blog CTA toward signup/tool flow | Career article CTA blocks |
| `signup_page_view` | User reached `/signup` | Signup page mount |
| `cv_upload_started` | User selected a CV file | Create/upload page |
| `cv_upload_completed` | CV upload and parse succeeded | Upload processing flow |
| `job_description_pasted` | User pasted a job description | Tailor CV form |
| `tailored_cv_generated` | Tailored CV draft succeeded | Tailoring flow |
| `cv_exported` | User generated or downloaded a CV export | CV editor export dialog |
| `payment_started` | Stripe Checkout session started | Shared checkout helper |
| `payment_completed` | User returned from Stripe success URL | In-app pricing page |

No CV text, job description text, file names, email addresses, or user identifiers are sent as event parameters.

## Recommended GA4 Key Events

Mark these as key events in GA4:

- `tailored_cv_generated`
- `cv_exported`
- `payment_completed`
- `signup_page_view`

GA4 key events are configured in the Analytics UI after the events are collected, or by creating the event names there first and marking them as key events.

## Current Production Verification

Production collection is considered healthy when DevTools shows:

- `https://www.googletagmanager.com/gtag/js?id=G-...` returning `200`.
- `https://www.google-analytics.com/g/collect` returning `204`.
- Custom events appearing as `en=<event_name>` in the request URL or POST payload.

Example confirmed events:

- `page_view`
- `blog_cta_click`

The `window.gtag` wrapper must push the JavaScript `arguments` object into `dataLayer`, matching Google's standard snippet. Do not change it back to pushing a plain array unless the tracking implementation is replaced and re-tested.

## Next Step Implementation Plan

### 1. Finish GA4 Admin Setup

Website: Google Analytics (`https://analytics.google.com`)

Go to `Admin` -> `Data display` -> `Events`, then mark these as key events:

- `tailored_cv_generated`
- `cv_exported`
- `payment_completed`
- `signup_page_view`

If an event is not listed yet, create the event name manually in GA4 with the exact spelling above, then mark it as a key event.

### 2. Register Custom Dimensions

Website: Google Analytics

Go to `Admin` -> `Data display` -> `Custom definitions`, then create event-scoped custom dimensions for the parameters that should be reportable in GA4.

Priority custom dimensions:

| Dimension name | Event parameter | Why it matters |
|---|---|---|
| Article slug | `article_slug` | See which blog pages drive CTA clicks |
| Category slug | `category_slug` | Compare SEO clusters by conversion intent |
| CTA text | `cta_text` | Compare CTA copy performance |
| CTA destination | `destination` | Confirm where blog clicks send users |
| Signup path | `path` | Confirm which signup/tool path users reached |
| Export format | `format` | Compare PDF vs DOCX export intent |
| CV kind | `cv_kind` | Compare master CV vs tailored CV exports |
| Checkout source | `source` | See where payment attempts started |
| Plan code | `plan_code` | Compare Pro vs Lifetime monetization intent |

Secondary dimensions if more diagnostic detail is needed:

| Dimension name | Event parameter | Why it matters |
|---|---|---|
| File extension | `file_extension` | Debug upload mix by file type |
| File size bucket | `file_size_bucket` | Debug upload friction by size |
| Parse status | `parse_status` | Monitor parser quality |
| Parser name | `parser_name` | Compare import parser behavior |
| Job role present | `has_role` | Measure form completeness |
| Company present | `has_company` | Measure form completeness |
| Job URL present | `has_job_posting_url` | Measure richer job input |

Do not create custom dimensions for CV text, job description text, file names, email addresses, or user identifiers.

### 3. Build The Main Funnel Exploration

Website: Google Analytics

Go to `Explore` -> `Funnel exploration`, then create this funnel:

| Step | Event |
|---|---|
| 1 | `blog_cta_click` |
| 2 | `signup_page_view` |
| 3 | `cv_upload_started` |
| 4 | `cv_upload_completed` |
| 5 | `job_description_pasted` |
| 6 | `tailored_cv_generated` |
| 7 | `cv_exported` |
| 8 | `payment_started` |
| 9 | `payment_completed` |

Use this funnel to identify the biggest drop-off before changing content, onboarding, pricing, or the editor flow.

Recommended breakdowns:

- `article_slug`
- `category_slug`
- `cta_text`
- `format`
- `plan_code`

### 4. Connect SEO To Conversion

Website: Google Analytics and Google Search Console

Link Search Console to GA4 so SEO data can be evaluated alongside product events.

Track these questions:

- Which articles get organic landing page traffic?
- Which articles drive `blog_cta_click`?
- Which articles lead to `signup_page_view`?
- Which articles eventually lead to `tailored_cv_generated` or `cv_exported`?
- Which SEO cluster has the best conversion quality: basics, tailoring, ATS, medical/NHS, or templates/checklists?

Do not judge SEO pages only by impressions or clicks. A lower-traffic article that drives `tailored_cv_generated` or `cv_exported` can be more valuable than a higher-traffic article with no product engagement.

### 5. Collect A Baseline Before Optimizing

Wait for either:

- At least 1-2 weeks of production data, or
- Enough event volume to see reliable funnel patterns.

During this baseline window, avoid changing too many CTAs, signup routes, pricing prompts, or upload flows at once. Otherwise it becomes hard to tell what caused conversion changes.

### 6. Optimize Based On The First Major Drop-Off

Use the funnel result to decide the next product or content change:

| Pattern | Likely next action |
|---|---|
| High article traffic, low `blog_cta_click` | Improve CTA placement, CTA copy, and article-product bridge |
| High `blog_cta_click`, low `signup_page_view` | Inspect routing, auth redirects, and CTA destination behavior |
| High `signup_page_view`, low `cv_upload_started` | Improve signup-to-upload onboarding |
| High `cv_upload_started`, low `cv_upload_completed` | Improve upload UX, parser reliability, and error handling |
| High `cv_upload_completed`, low `job_description_pasted` | Improve job description step clarity and empty-state UI |
| High `job_description_pasted`, low `tailored_cv_generated` | Inspect tailoring flow errors, latency, and generation UX |
| High `tailored_cv_generated`, low `cv_exported` | Improve export CTA, preview confidence, and paywall timing |
| High `payment_started`, low `payment_completed` | Inspect Stripe Checkout friction, pricing clarity, and failed/canceled sessions |

### 7. Later: Make Payment Tracking Server-Side

The current `payment_completed` event fires when the user returns from Stripe to the frontend success URL. This is useful for funnel analysis, but it can miss purchases if the user closes the tab, loses network, or does not return to the app.

Future implementation:

- Add Stripe webhook handling for completed checkout sessions.
- Send `payment_completed` from the backend using GA4 Measurement Protocol.
- Include stable non-PII attribution such as checkout session ID, plan code, value, and currency.
- Keep the frontend success event as a secondary UI confirmation, but rely on the webhook for revenue reporting.

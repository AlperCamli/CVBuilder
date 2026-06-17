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

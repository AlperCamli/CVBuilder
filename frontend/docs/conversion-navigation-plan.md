# CV Builder conversion and navigation plan

Prepared 22 October 2026. Status: proposal for implementation and experiments.

The recommended approach is to let Free visitors reach a useful CV quickly and let explicit Pro buyers reach checkout directly. Preserve the task behind each CTA through authentication, payment, cancellation, and return visits. Sell Pro primarily around creating applications for more jobs and using more assistance, while delivering the Free experience promised before the user starts.

The current workspace already supports both uploading and creating a new CV in onboarding. Build on that work. The shared public pricing handler still sends Pro buyers into onboarding; checkout resumes when they reach an eligible authenticated route; success and cancellation currently return to account pricing. The current four-question sequence remains ahead of signup. These observations describe local source, not verified production deployment state.

There is no measured traffic, funnel, revenue, or cost baseline attached to this proposal. Expected improvements below are hypotheses, not predicted percentage lifts.

## 1. Define success before changing the offer

Use two primary outcomes together: more visitors getting a usable result and more contribution per visitor. Registration alone is insufficient.

| Measure | Definition and use |
| --- | --- |
| Activation | First usable CV preview and first successful export, reported separately. For tailoring visitors, also measure the first job-specific CV generated. |
| Purchase conversion | Unique eligible visitors with a first positive paid charge within a defined window, initially 30 days. Separate immediate buyers from Free entrants. |
| Contribution per visitor | Collected revenue less refunds, payment fees, and attributable variable AI/rendering/storage costs, divided by eligible unique visitors in the cohort. For paid channels, also report acquisition cost and contribution after that cost. |
| Trial conversion | Trial starts, first positive charge, trial cancellations, and subsequent refunds as separate events. A zero-value trial checkout is not a paid customer. |
| Journey health | CTA-to-next-step completion, time to first useful result, authentication recovery, checkout completion, successful return to task, errors, and unexpected redirects. |

Measure 7-day activation, 30-day first-payment/contribution, and later retention/refunds using mature cohorts. Document the denominator, identity rules, observation window, consent coverage, and internal/bot exclusions. Segment by CTA, task, device, locale/market, acquisition channel, and Free/Pro/trial entry. Use a small set of predefined segments to avoid drawing conclusions from tiny subgroups.

Keep optional analytics subject to the existing consent choice; payment records and operational counters should follow their existing purposes and access rules. Do not send CV text, job descriptions, personal details, document IDs, or tokens to marketing analytics. Extend the current analytics parameter allowlist deliberately for safe CTA/task enums. Do not treat completing the editor tour as completing a CV.

The frontend currently emits `payment_completed` from the success return. Introduce separate checkout-return, trial-started, subscription-confirmed, and positive-payment events. Verified billing records/webhooks should determine purchase reporting and entitlements, including users who pay but never return to the browser. Stripe documents subscription events and asynchronous billing updates in its [subscription webhook guidance](https://docs.stripe.com/billing/subscriptions/webhooks).

## 2. Make each CTA carry an explicit task and commercial choice

Task and commercial choice are independent. Someone can want to tailor a CV while choosing Free or Pro. Clicking a template is evidence of a template preference, not evidence of willingness to pay. Reading an article is context, not permission to start a subscription.

| CTA or context | Intent to retain | Recommended next experience |
| --- | --- | --- |
| Tailor my CV free | Task: tailor; commercial: Free | Upload or create CV, then job description and tailoring. Do not ask the user to choose a goal again. |
| Improve my CV | Task: improve; commercial: Free unless explicitly changed | Import, review, improve, editor. Offer tailoring afterward as an optional next action. |
| Create a CV | Task: create | Start a new draft; offer importing as an alternative. |
| Use this template / Make it yours | Task: design; selected template | Preview or select the template, upload/create, editor with that template applied. Allow changing it. |
| Generic Start Free | Commercial: Free; task unknown | One compact task choice: tailor, improve, or create. Skip this choice if context already supplies the answer. |
| Choose Pro Monthly/Weekly/Annual | Commercial: paid; exact billing period | Minimal authentication if needed, plan confirmation/checkout, then resume known task or select upload/create if none exists. No questionnaire or upload prerequisite. |
| Start the Pro trial | Commercial: trial; exact eligible offer | Short terms and eligibility step, authentication if needed, explicit trial confirmation/checkout, then task. |
| Try the demo | Task: explore | Stay in the demo. A subsequent start CTA offers to create a real CV; importing the fictional sample's content is not implied. |
| Article product CTA | Explicit task, supported module, and relevant source | Enter that task's flow. Medical/NHS CTAs must preserve a supported specialization when the label promises it. |
| Sign in | Existing account; pending task if any | Resume that task. Show Dashboard only when no valid task is pending. |
| Pricing / full comparison | Compare plans; selected period | Open pricing and retain billing period and locale. Browsing does not initiate purchase. |

Internally, preserve a bounded intent record: task, Free/paid/trial choice, source CTA, billing period if selected, template/module if selected, locale, current draft/task step, and creation/expiry timestamps. Persist the task through OAuth and email verification. Transfer authenticated drafts and resumable steps to the account; browser-only progress cannot guarantee cross-device recovery before that handoff.

The latest explicit choice wins. Clicking Free clears a pending purchase while retaining relevant task progress. An expired purchase choice becomes a visible resume/confirm option. Navigation to an unrelated app screen must never start checkout merely because an old browser value exists. Server-owned prices and eligibility remain authoritative; changed terms require confirmation.

## 3. Organize the landing page around a credible result

Keep the existing visual direction and useful demo; change the hierarchy and promises before undertaking a complete visual redesign.

Recommended order:

1. Hero: a specific outcome such as “A CV tailored to the job you want.” Primary action: “Tailor my CV free.” Secondary action: “Try the demo.” Smaller “Create a new CV” entry for people without a document. State what Free includes and that it requires no card.
2. A compact before/after example tied to an actual job requirement, showing that facts remain accurate and editable. Only publish substantiated customer claims or testimonials; use clearly labeled sample results otherwise.
3. Three understandable steps: add a CV, add the job, review and export. Explain that users can also create a CV from scratch.
4. Interactive demo, with a visible “Try with my CV” handoff. Keep the demo usable without requiring a tour or signup.
5. Template showcase. Starting from a template preserves it into the real editor.
6. Free/Pro comparison: Free delivers a complete starting result; Pro supports an active job search across more roles. Display actual localized billing totals prominently.
7. Short answers covering Free limits, billing/renewal, factual accuracy, editable output, and data handling, followed by the same primary CTA.

Use a short header: product/demo, templates, pricing, resources, sign in, and one primary CTA. On mobile, avoid simultaneous guide, language, pricing, and promotional overlays. Preserve an accessible language switcher; test initial locale selection separately from revenue changes. Ask required processing choices near the action that uses them.

Landing and standalone pricing should use the same plan definitions, amounts, trial eligibility explanation, CTA labels, and destination logic. Show “amount per month, billed monthly” as the primary Monthly price; weekly equivalents can be supporting information. Show the full Annual charge before checkout. Weekly, Monthly, and Annual are billing choices for the same Pro features.

The recommendation to defer secondary choices follows [NN/g's progressive disclosure guidance](https://www.nngroup.com/articles/progressive-disclosure/). It motivates reducing irrelevant decisions; it does not mean hiding subscription terms or necessary processing choices.

## 4. Shorten onboarding and keep it specific to the job

Recommended Free tailoring target:

`Tailor CTA -> upload/create -> job description -> first tailored preview -> save account -> review/editor -> included export -> optional next-job Pro offer`

Ask for career or education details only where a task needs them. Move referral-source questions after activation or into an optional survey. Keep inferred intent editable with a small “Change goal” control. Education and career answers must never become invented CV facts.

Recommended improvement target:

`Improve CTA -> upload -> review and useful suggestions -> save account -> improved CV/editor -> export`

A score can be useful, but should not become an obligatory stop for users who explicitly want styling or tailoring. Put review details beside the next action and allow manual correction if extraction is unreliable. Improvement should not force the user into a job-description form.

Recommended create/template target:

`Create/template CTA -> new draft or import -> relevant content/editor with selected template -> save account -> export`

Ask for language only when it cannot be sensibly established or needs confirmation. A blank draft should not require AI processing merely to enter content manually.

Showing personal value before registration is the target to evaluate, not an instruction to expose the current protected import result. The first implementation should remove the four survey screens and preserve the existing authenticated claim/handoff. A later controlled experiment can add a guest-owned, appropriately scoped preview before signup, accounting for extraction cost, recovery, and ownership. Keep a coherent pre-signup import/create step even if the first actual preview remains authenticated in the initial release.

Account prompts should explain the immediate benefit: “Save this CV and download your included PDF.” Use existing Google/email methods and preserve state through verification. Do not add contact or profile fields that are unnecessary for the next task.

[NN/g's research on login walls](https://www.nngroup.com/articles/login-walls/) supports making benefits clear before registration. [Baymard's checkout research](https://baymard.com/research-articles/delayed-account-creation) supports minimizing account-related distractions during purchase. Baymard's findings are from ecommerce; they are a rationale for testing a shorter CV checkout, not a CV-specific conversion benchmark. Keep account authentication before subscription checkout initially because subscriptions need a reliable account owner; a guest-purchase redesign is a separate project.

## 5. Ask for Pro when the user's choice or activity supports it

| Moment | Recommended offer | Interruption level |
| --- | --- | --- |
| Explicit public Pro CTA | Confirm selected subscription and open checkout after minimal authentication | Direct purchase flow; skip upload and survey |
| Explicit trial CTA | Explain charge today, trial end, renewal total/frequency, card requirement, and eligibility; confirm | Explicit opt-in; never start a trial from Free signup |
| Before first useful Free result | Visible plan/usage information only | No automatic upgrade modal |
| First meaningful preview | Contextual line explaining Pro for additional applications | Nonblocking |
| First included export | Complete the promised download | No surprise paywall |
| After a successful export | Optional inline next-step offer: tailor another role, matching cover letter, or Pro | Dismissible and tied to the user's next task |
| User selects a Pro-only feature or reaches a disclosed limit | Explain the exact feature/limit and show the applicable plans | Block only that action; keep existing work available |
| Return after dismissing an offer | Continue the task | Do not reopen the same promotion on focus/blur or route changes |

Use clear language such as “Applying to more roles? Create a version for each with Pro.” A first-time stylist may care more about an editable, polished document than job tracking; show the benefits relevant to that intent. A customer choosing Pro already expressed willingness to pay and should not have to prove engagement first.

## 6. Repair payment return and recovery before increasing traffic

Recommended paid path:

`Choose Pro -> authenticate if required -> checkout with selected terms -> verify subscription -> resume exact task -> first useful CV`

Recommended trial path:

`Choose trial -> explicit terms/eligibility -> authenticate if required -> trial checkout -> confirmed trial -> resume task`

Keep the selected plan summary visible around authentication. For unknown task intent, place upload/create immediately after purchase; for a known draft or pending export, resume that exact work. Confirm active subscription or trial before unlocking the paid action, and show bounded “Confirming your subscription” recovery when billing updates are delayed. Preserve drafts if confirmation fails.

Checkout cancellation returns to the saved task with “Continue Free” and “Retry selected plan.” A Free continuation must respect actual Free limits and must not claim a premium-only action succeeded. Payment failure stays recoverable without duplicating CVs or subscriptions. Refresh and repeated callbacks must not create duplicate charges. Existing paid customers resume their work; plan changes use an appropriate billing-management flow rather than a second subscription checkout.

Expiry, logout, and account switches must not silently apply someone else's saved draft or purchase intent. After browser storage fails, show a clear recovery step rather than navigating to an unrelated page. Revalidate template/module compatibility and offer an explicit alternative when a previously selected template is unavailable.

## 7. Make monetization changes as separate experiments

Start with existing Free allowances as the control: the current plan advertises three customized CVs, five exports, and twenty AI actions per month. Complete one meaningful Free experience before adding stronger pressure. Existing promises should be honored during the navigation release.

| Decision | Initial recommendation | Trade-off and later test |
| --- | --- | --- |
| Free outcome | Keep the advertised included export; sell additional applications and assistance | Some single-use visitors will finish without paying; they may still recommend or return. An export paywall can increase purchase pressure but risks losing activation and trust. |
| Free limits | Keep current allowances while fixing journeys | Higher activation and variable cost; potentially weak upgrade pressure. Later compare one unique job-tailored CV/month against three, with clear terms, protection for existing promises, and contribution/refund guardrails. Avoid charging users quota for harmless re-downloads of the same file. |
| Pro checkout timing | Immediate after explicit purchase choice and authentication | More early buyers but some may purchase before understanding the product. Keep a visible “Try Free first” option and measure post-purchase activation/refunds. |
| Trial | Keep the existing explicit card-required offer as a control, separate from Free | Fewer trial starts but payment readiness is stronger. Later test a longer trial or a no-card trial separately; measure positive charges and cost per converted customer, not trial volume alone. |
| Recommended billing | Monthly, with Weekly and Annual available | Less upfront revenue than Annual; clearer fit for a time-bounded job search. Test Annual emphasis only with actual purchase/refund data. |
| One-time access | Consider a nonrenewing job-search pass after the core flow is working | May attract subscription-averse customers; can cannibalize recurring subscriptions and requires additional billing/product work. |

Competitor offers are useful references rather than proof of what will work here. For example, [Resume.io's pricing](https://resume.io/pricing) exposes a restricted Free tier and a renewing trial; its offer also varies by market. Copying its paywall would be a product decision, not an evidence-based prediction of higher contribution for this app.

## 8. Prepare implementation in dependency order

| Phase | Deliverables | Completion criteria |
| --- | --- | --- |
| 0: baseline and contracts | CTA inventory, destination matrix, intent/state definition, funnel events, verified payment reporting | Each CTA has one documented next step; Free, paid, and trial cohorts are distinguishable; trial returns are not counted as positive payments |
| 1: navigation and checkout | Shared intent handling, explicit checkout entry, success/cancel/task recovery, stale-intent handling, subscriber behavior | No unrelated navigation launches checkout; refresh/auth/payment round trips preserve the intended task |
| 2: task-specific onboarding | Remove/defer survey, preserve template/module, separate improve/tailor/create, keep existing account handoff | Users reach the selected task without answering the same intent twice; uploaded and blank CV paths both work |
| 3: landing and pricing | Hero hierarchy, outcome example, task-specific template/demo handoffs, consistent Free promises and billing totals | Every visible claim and CTA agrees with the next screen and plan entitlements |
| 4: experiments and acquisition | Guest-preview timing, contextual offers, quotas/trials, then additional acquisition channels | Decisions use predefined outcomes and mature cohorts; no worsening of payment errors, missing drafts, refunds, or unit economics |

Likely code areas: `pages/designs/GuidedJourney.tsx`, `pages/designs/DesignShared.tsx`, `pages/designs/TemplateShowcase.tsx`, article CTA content, `pages/PreSignupOnboarding.tsx`, `pages/OnboardingResume.tsx`, `pages/CVScore.tsx`, post-auth redirect handling, pending checkout and its resumer, checkout redirect/return handling, backend billing confirmation, and analytics. These are implementation targets; this plan does not alter them.

Prepare/reuse these screens and states before implementation: intent-specific entry, import/create, relevant job details, useful result/review, account save/verification, explicit checkout confirmation, subscription confirmation, recovered editor/task, contextual upgrade/limit state, and interrupted/expired journey recovery. Do not build a separate full onboarding for every CTA; share the same steps and vary the starting step, supplied context, and next destination.

## 9. Verify the complete journey and choose experiments deliberately

Acceptance scenarios must include every commercial entry (Free, paid Weekly/Monthly/Annual, trial), task (tailor, improve, create, template), and relevant account state. Use representative pairings rather than blindly multiplying every combination, with explicit coverage for:

- New visitor, signed-in Free, signed-in Pro, and expired session.
- Upload and scratch creation; new CV versus an existing saved CV.
- Google, email, verification, sign-in/signup switching, same-device refresh, and unavailable recovery.
- Selected template/module, English/Turkish, mobile, keyboard, and browser Back.
- Checkout success, cancellation, declined payment, delayed billing update, unavailable trial, changed price, and stale purchase choice.
- Dismissed offer staying dismissed; selecting Free clearing purchase intent; switching account not reusing another account's draft.
- Correct activation measurement: opening export is not downloading a CV; trial start is not a positive payment.

Run task walkthroughs with 5-8 target users to expose comprehension/navigation problems before conversion tests; this is qualitative research, not a statistical estimate of lift. Ask users to explain what they expect to happen after each CTA and what they believe they will pay.

Sequence experiments: fewer questions first; signup timing next; contextual offer placement next; then quota or trial changes. Correctness repairs such as restoring drafts and preventing unexpected checkout are not experiments. For actual experiments, assign a stable variant, preselect a primary metric and guardrails, estimate sample size from the measured baseline and detectable effect, and wait for the required observations and conversion window. If traffic is low, use fewer variants and longer observation rather than relying on daily fluctuations.

[Amplitude's activation guidance](https://amplitude.com/books/user-engagement/activating-new-users) supports measuring the progression to experienced value and later value exchange. Here, the proposed activation events must be validated against repeat applications and paying behavior rather than assumed to be perfect predictors.

After the core journeys work, prioritize acquisition that matches this product: job-tailoring and ATS advice, role-specific/template pages with matching entry intent, and optional referrals after a successful export. Assess channel quality by activated users and net contribution. Scale paid campaigns after attribution and checkout recovery are trustworthy; registration-only campaigns can buy activity without sustainable sales.

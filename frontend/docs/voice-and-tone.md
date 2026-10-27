# Voice and tone

How jobspecificCV talks to people, in English and Turkish. Use this for every interface string, landing page copy, FAQ and SEO text. New languages added in Language Studio should follow the same principles.

## Who we are talking to

People looking for a job. Many are anxious, short on time and tired of sending applications that go nowhere. They want a CV they're proud of, and they want to feel it's still *theirs*.

## Our voice

**Soft, friendly, encouraging — like a helpful friend who happens to be good at CVs.**

- **Warm, not cute.** Friendly sentences, no baby talk, no exclamation-mark spam (one per screen at most).
- **Encouraging, not pushy.** Celebrate progress ("Nice — your CV is ready"), never shame ("You haven't…", "You've hit your limit").
- **Clear before clever.** Short sentences. One idea each. Plain words over jargon.
- **About the user, not the system.** Say what they get or can do next, not what the system requires. "Start tailoring" beats "Activation required to access tailoring".
- **Honest.** Never hide a price, a renewal or a limit. Soft wording is about *how* we say it, never *what* we leave out.
- **Calm when things go wrong.** Say what happened in human terms, reassure about their work, and offer the next step.

## Rules for every string

1. **Buttons and labels stay short.** 1–4 words, a verb first when it's an action: "Save", "Tailor my CV", "Try again". Don't make labels chatty.
2. **Sentences carry the warmth.** Helper text, empty states, onboarding, dialogs and the mascot are where friendliness lives.
3. **Errors** follow *what happened → it's okay → what to do*: "We couldn't load your plan details. Your work is safe — try again in a moment."
   Avoid "Failed", "Invalid", "Error:", "Unable to", "Please" at the start of sentences.
4. **Empty states invite** instead of reporting absence: "No CVs yet — let's create your first one."
5. **Limits and paywalls** describe what opens up, not what's blocked: "Start your free trial to export your CV" instead of "Exports require an active subscription".
6. **Keep facts exact.** Durations, prices, plan names, `{{placeholders}}` and legal meaning never change. Keep leading/trailing spaces and punctuation on fragments that are joined with other text in code.
7. **Product words stay consistent** — see the glossary.

## Talking about the trial and the card

The 3-day trial needs a card. That is a real hesitation point, so we:

- **Lead with what it costs today:** nothing. "Free for 3 days — you won't pay anything today."
- **Say it once, near the button, in one calm line**, not in warnings repeated across the page.
- **Explain why** when it helps: the card keeps the trial fair and lets Pro continue without interruption if they want to keep it.
- **Reassure on safety, truthfully:** "Payments are handled securely by Stripe. We never see or store your card number."
- **Make cancelling feel easy:** "Cancel anytime in a couple of clicks from your account."
- **Still state renewal clearly** wherever someone commits: price, when it starts, and that it renews weekly unless cancelled before the trial ends. This is required by consumer-protection rules and it's what earns trust.
- Don't promise anything the product doesn't do (for example, reminder emails) until it exists.

## Turkish

### Sen and siz

- **"Sen"** everywhere by default: landing page, onboarding, dashboard, CV editor, tailoring, mascot, support/help, errors and empty states.
- **"Siz"** only in formal parts: **payment screens** (pricing page, checkout, trial activation terms, billing/subscription management, payment errors, upgrade/paywall dialogs) and **privacy/legal** (privacy notice, cookie and privacy controls, account deletion, data requests).
- Short trial lines on "sen" pages (landing, onboarding, FAQ) stay in "sen": "3 gün ücretsiz · Bugün ödeme yok · İstediğin zaman iptal et".
- Never mix both inside one string or one dialog. Buttons use the plain verb stem in either register ("Kaydet", "Devam et", "Ödemeye geç").

### Natural Turkish

- Write it as a Turkish product would, not as a word-for-word translation. Re-order sentences freely.
- Prefer everyday words: "indir" for downloading a file, "ödeme" over "faturalandırma" where it reads naturally, "aç/başlat" over "etkinleştir" when talking to people ("denemeni başlat").
- Avoid stiff openers: "Lütfen…", "…başarısız oldu", "…gerekmektedir", "…edilmesi gerekir". Use "…yapamadık", "…için … yeterli", "Bir daha dener misin?".
- Typographic apostrophe `’` for suffixes, as in the existing catalog.

### "CV", never "özgeçmiş"

Always "CV" in Turkish UI. Suffixes follow the pronunciation *si-vi*:

| Case | sen | siz |
| --- | --- | --- |
| accusative | CV’ni, CV’yi | CV’nizi |
| possessive | CV’n | CV’niz |
| dative | CV’ne, CV’ye | CV’nize |
| locative | CV’nde, CV’de | CV’nizde |
| ablative | CV’nden, CV’den | CV’nizden |
| plural | CV’lerin, CV’leri | CV’leriniz |
| compound | Ana CV, İşe özel CV, CV puanı | |

## Glossary

| English | Turkish | Notes |
| --- | --- | --- |
| CV | CV | never "özgeçmiş" or "resume" in UI |
| main CV | ana CV | the master CV a user tailors from |
| tailored CV | işe özel CV | |
| tailor (verb) | uyarlamak / işe göre uyarlamak | |
| cover letter | ön yazı | |
| job tracker | başvuru takibi | |
| export / download | indir | "Export" in EN is fine for the action; TR "PDF olarak indir" |
| dashboard | ana sayfa / panel | not "Kontrol Paneli" |
| free trial | ücretsiz deneme | |
| subscription | abonelik | siz context |
| billing | ödeme ve abonelik | siz context |
| checkout | ödeme sayfası | siz context |
| AI | yapay zekâ | |
| suggestion | öneri | |
| score | puan | |
| editor | editör | not "düzenleyici": editörde, editöre, CV editörü |
| template | template | Turkish UI uses the English word: template’i, template’ler, template ile |

## Before and after

| Before | After |
| --- | --- |
| 3-day free trial · Card required to activate | Free for 3 days · Nothing to pay today · Cancel anytime |
| Failed to load billing details. | We couldn’t load your plan details. Please try again in a moment. |
| You've hit your Free plan limit | You’ve made great use of your free plan |
| Activate a trial or purchase Pro to access the application. | Start your free trial to unlock everything. |
| Özgeçmişinizi yükleyin | CV’ni yükle |
| Faturalandırma bilgileri yüklenemedi. | Ödeme bilgilerinizi şu an yükleyemedik. Birazdan tekrar deneyebilirsiniz. |

## Where text lives

- Interface catalogs: `src/app/localization/en.json` and `tr.json`. English keys are the source text and stay unchanged; edit the **values** (Language Studio does the same).
- Landing FAQ and SEO metadata: `src/content/seo-meta.mjs` (the visible FAQ and its structured data share this source).
- Backend authentication emails: `backend/supabase/templates/`.

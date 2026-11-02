import { z } from "zod";

// Mirrors FUNNEL_EVENTS in frontend/src/app/integration/funnel-events.ts (parity test:
// tests/funnel-events.unit.test.ts). Only add events; the admin metrics read them by name.
export const FUNNEL_EVENTS = [
  "landing_view",
  "pricing_view",
  "cta_click",
  "onboarding_upload_view",
  "onboarding_upload_started",
  "onboarding_upload_completed",
  "onboarding_upload_failed",
  "onboarding_manual_create",
  "onboarding_question_view",
  "onboarding_signup_view",
  "onboarding_score_preview",
  "signup_completed",
  "email_verification_required",
  "score_view",
  "score_action",
  "free_tailoring_started",
  "free_tailoring_finished",
  "free_improve_used",
  "paywall_shown",
  "checkout_view",
  "checkout_redirect",
  "checkout_success",
  "checkout_canceled",
] as const;

export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

const CHECKOUT_OFFERS = ["trial", "pro"] as const;

// The only detail values each event may carry (the comments of the frontend list; checked against
// its call sites by tests/funnel-events.unit.test.ts). Any other detail is dropped and the event
// counted without one, so free text never reaches the counters.
export const FUNNEL_EVENT_DETAILS: Partial<Record<FunnelEvent, readonly string[]>> = {
  cta_click: ["header", "hero", "final", "mascot", "pricing_trial", "pricing_pro", "template", "demo_export"],
  onboarding_question_view: ["goal", "career_stage", "education", "source"],
  onboarding_score_preview: ["scored", "unscored"],
  signup_completed: ["google", "email"],
  score_action: ["editor", "tailor", "improve"],
  paywall_shown: ["export", "ai", "tailoring", "cover_letter", "other"],
  checkout_view: CHECKOUT_OFFERS,
  checkout_redirect: CHECKOUT_OFFERS,
  checkout_success: CHECKOUT_OFFERS,
};

// Campaign sources kept as sent; any other utm_source is counted as "other", so per-recipient or
// per-link identifiers in a campaign URL never reach the counters.
export const UTM_SOURCES = [
  // Search and AI assistants
  "google", "bing", "yandex", "duckduckgo", "yahoo", "chatgpt", "perplexity", "gemini", "claude", "copilot",
  // Social and messaging
  "instagram", "tiktok", "facebook", "linkedin", "x", "twitter", "youtube", "reddit", "threads", "pinterest",
  "whatsapp", "telegram", "discord",
  // Email
  "email", "newsletter",
  // Job boards
  "kariyer", "eleman", "indeed", "glassdoor", "secretcv", "youthall",
] as const;

// Common spellings of the same sources.
const UTM_ALIASES: Record<string, (typeof UTM_SOURCES)[number]> = {
  ig: "instagram",
  fb: "facebook",
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "lnkd.in": "linkedin",
  "t.co": "x",
  mail: "email",
  "kariyer.net": "kariyer",
  "eleman.net": "eleman",
};

const KNOWN_UTM = new Set<string>(UTM_SOURCES);

export const normalizeFunnelDetail = (event: FunnelEvent, detail: string | undefined): string | undefined =>
  detail !== undefined && FUNNEL_EVENT_DETAILS[event]?.includes(detail) ? detail : undefined;

export const normalizeUtmSource = (utmSource: string | undefined): string | undefined => {
  if (utmSource === undefined) return undefined;
  if (KNOWN_UTM.has(utmSource)) return utmSource;
  return UTM_ALIASES[utmSource] ?? "other";
};

export const funnelEventSchema = z
  .object({
    event: z.enum(FUNNEL_EVENTS),
    detail: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).optional(),
    locale: z.enum(["en", "tr"]),
    device: z.enum(["mobile", "desktop"]),
    utm_source: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,39}$/).optional(),
  })
  .strict()
  .transform(({ detail, utm_source, ...rest }) => {
    const allowedDetail = normalizeFunnelDetail(rest.event, detail);
    const source = normalizeUtmSource(utm_source);
    return { ...rest, ...(allowedDetail ? { detail: allowedDetail } : {}), ...(source ? { utm_source: source } : {}) };
  });

export type FunnelEventInput = z.infer<typeof funnelEventSchema>;

// Crawlers, link previews, monitors and scripted clients; real browsers never match.
const BOT_RE =
  /bot|crawl|spider|slurp|headless|lighthouse|inspectiontool|preview|facebookexternalhit|curl|wget|python|httpclient|okhttp|axios|node-fetch|go-http-client|java\/|scrapy|phantomjs|puppeteer|playwright|selenium/i;

export const isBotUserAgent = (userAgent: string | undefined): boolean => !userAgent?.trim() || BOT_RE.test(userAgent);

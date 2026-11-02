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

export const funnelEventSchema = z
  .object({
    event: z.enum(FUNNEL_EVENTS),
    detail: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/).optional(),
    locale: z.enum(["en", "tr"]),
    device: z.enum(["mobile", "desktop"]),
    utm_source: z.string().regex(/^[a-z0-9][a-z0-9_.-]{0,39}$/).optional(),
  })
  .strict();

export type FunnelEventInput = z.infer<typeof funnelEventSchema>;

// Crawlers, link previews, monitors and scripted clients; real browsers never match.
const BOT_RE =
  /bot|crawl|spider|slurp|headless|lighthouse|inspectiontool|preview|facebookexternalhit|curl|wget|python|httpclient|okhttp|axios|node-fetch|go-http-client|java\/|scrapy|phantomjs|puppeteer|playwright|selenium/i;

export const isBotUserAgent = (userAgent: string | undefined): boolean => !userAgent?.trim() || BOT_RE.test(userAgent);

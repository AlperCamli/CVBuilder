import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app/create-app";
import { FUNNEL_EVENT_DETAILS, FUNNEL_EVENTS, isBotUserAgent, normalizeUtmSource } from "../src/modules/funnel-events/funnel-events.contract";
import { createFunnelEventsRouter } from "../src/modules/funnel-events/funnel-events.routes";
import { FunnelEventsService } from "../src/modules/funnel-events/funnel-events.service";
import { createTestConfig } from "./helpers/in-memory";

const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const event = { event: "cta_click", detail: "hero", locale: "tr", device: "mobile", utm_source: "instagram" };

function app(limiter: express.RequestHandler = (_req, _res, next) => next()) {
  const record = vi.fn(async () => undefined);
  const server = express();
  server.use(express.json());
  server.use(createFunnelEventsRouter({ record } as unknown as FunnelEventsService, limiter));
  server.use((err: { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode ?? 500).json({});
  });
  return { server, record };
}

describe("funnel events contract", () => {
  it("mirrors the frontend event list exactly", () => {
    const source = readFileSync(join(__dirname, "../../frontend/src/app/integration/funnel-events.ts"), "utf-8");
    const list = source.match(/FUNNEL_EVENTS = \[([\s\S]*?)\] as const/)?.[1] ?? "";
    expect([...list.matchAll(/"([a-z_]+)"/g)].map((m) => m[1])).toEqual([...FUNNEL_EVENTS]);
  });

  it("allows exactly the detail values listed next to the frontend events", () => {
    const source = readFileSync(join(__dirname, "../../frontend/src/app/integration/funnel-events.ts"), "utf-8");
    const listed = Object.fromEntries(
      [...source.matchAll(/"([a-z_]+)",\s*\/\/ detail: ([a-z_ |]+)/g)].map((m) => [m[1], m[2].split("|").map((value) => value.trim())])
    );
    expect(listed).toEqual(FUNNEL_EVENT_DETAILS);
  });

  it("allows every detail the frontend sends", () => {
    const root = join(__dirname, "../../frontend/src");
    const files = (readdirSync(root, { recursive: true }) as string[])
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map((file) => readFileSync(join(root, file), "utf-8"));
    const sent: Array<[string, string]> = [];
    for (const text of files) {
      for (const m of text.matchAll(/trackFunnelEvent\("([a-z_]+)",\s*"([^"]+)"\)/g)) sent.push([m[1], m[2]]);
      // Ternaries of literals, e.g. ok ? "trial" : "pro".
      for (const m of text.matchAll(/trackFunnelEvent\("([a-z_]+)",[^;\n]*\?\s*"([^"]+)"\s*:\s*"([^"]+)"\)/g)) sent.push([m[1], m[2]], [m[1], m[3]]);
      for (const m of text.matchAll(/(?:trackCtaClick\(|\bcta=)"([^"]+)"/g)) sent.push(["cta_click", m[1]]);
      for (const m of text.matchAll(/(?:viewDetail = [^;\n]*\?\s*)"([^"]+)"\s*:\s*"([^"]+)"/g)) sent.push(["checkout_view", m[1]], ["checkout_view", m[2]]);
      const questions = /QUESTION_FUNNEL_DETAIL: Record<[^>]+> = \{([\s\S]*?)\}/.exec(text)?.[1];
      for (const m of questions?.matchAll(/:\s*"([^"]+)"/g) ?? []) sent.push(["onboarding_question_view", m[1]]);
      const kinds = /function previewKind\([^)]*\): ([^{]+)\{/.exec(text)?.[1];
      for (const m of kinds?.matchAll(/"([a-z_]+)"/g) ?? []) sent.push(["onboarding_score_preview", m[1]]);
    }
    const surfaces = /export type PaywallSurface = ([^;]+);/.exec(files.find((text) => text.includes("export type PaywallSurface")) ?? "")?.[1] ?? "";
    for (const m of surfaces.matchAll(/"([a-z_]+)"/g)) sent.push(["paywall_shown", m[1]]);
    for (const action of ["editor", "tailor", "improve"]) sent.push(["score_action", action]);
    expect(sent.length).toBeGreaterThan(25);
    expect(sent.filter(([event, detail]) => !FUNNEL_EVENT_DETAILS[event as keyof typeof FUNNEL_EVENT_DETAILS]?.includes(detail))).toEqual([]);
  });

  it("keeps known campaign sources and counts every other one as other", () => {
    expect(["google", "instagram", "kariyer", "x"].map(normalizeUtmSource)).toEqual(["google", "instagram", "kariyer", "x"]);
    expect(["ig", "chatgpt.com", "lnkd.in"].map(normalizeUtmSource)).toEqual(["instagram", "chatgpt", "linkedin"]);
    expect(["mailchimp_4f2a9c", "user-12345", "acme.example"].map(normalizeUtmSource)).toEqual(["other", "other", "other"]);
    expect(normalizeUtmSource(undefined)).toBeUndefined();
  });

  it("treats crawlers, scripts and missing user agents as bots", () => {
    expect(isBotUserAgent(BROWSER)).toBe(false);
    for (const ua of [undefined, " ", "Googlebot/2.1", "facebookexternalhit/1.1", "curl/8.4", "HeadlessChrome/120", "python-requests/2.31"]) {
      expect(isBotUserAgent(ua)).toBe(true);
    }
  });
});

describe("POST /funnel-events", () => {
  it("counts a beacon JSON body and answers 204 without a body", async () => {
    const { server, record } = app();
    const response = await request(server).post("/funnel-events").set("User-Agent", BROWSER)
      .set("Content-Type", "application/json").send(JSON.stringify(event)).expect(204);
    expect(response.text).toBe("");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(record).toHaveBeenCalledWith(event);
  });

  it("accepts a text/plain body and optional detail and utm_source", async () => {
    const { server, record } = app();
    await request(server).post("/funnel-events").set("User-Agent", BROWSER)
      .set("Content-Type", "text/plain").send(JSON.stringify({ event: "landing_view", locale: "en", device: "desktop" })).expect(204);
    expect(record).toHaveBeenCalledWith({ event: "landing_view", locale: "en", device: "desktop" });
  });

  it("drops details outside the event's allowlist and maps unknown campaigns to other", async () => {
    const { server, record } = app();
    const send = (body: object) => request(server).post("/funnel-events").set("User-Agent", BROWSER).send(body).expect(204);
    await send({ ...event, detail: "newsletter_link_42", utm_source: "crm_contact_8812" });
    await send({ event: "landing_view", detail: "hero", locale: "en", device: "desktop", utm_source: "ig" });
    await send({ event: "checkout_view", detail: "trial", locale: "en", device: "desktop" });
    expect(record.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      { event: "cta_click", locale: "tr", device: "mobile", utm_source: "other" },
      { event: "landing_view", locale: "en", device: "desktop", utm_source: "instagram" },
      { event: "checkout_view", detail: "trial", locale: "en", device: "desktop" },
    ]);
  });

  it("silently ignores bots", async () => {
    const { server, record } = app();
    await request(server).post("/funnel-events").set("User-Agent", "Mozilla/5.0 (compatible; bingbot/2.0)").send(event).expect(204);
    await request(server).post("/funnel-events").set("User-Agent", "").send(event).expect(204);
    expect(record).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...event, event: "page_view" }],
    [{ ...event, detail: "Free text with spaces" }],
    [{ ...event, utm_source: "https://evil.example" }],
    [{ ...event, locale: "de" }],
    [{ ...event, device: "tablet" }],
    [{ ...event, email: "someone@example.invalid" }],
    [{ event: "landing_view" }],
  ])("rejects payloads outside the contract (%j)", async (body) => {
    const { server, record } = app();
    await request(server).post("/funnel-events").set("User-Agent", BROWSER).send(body).expect(400);
    expect(record).not.toHaveBeenCalled();
  });

  it("applies the per-IP limiter before counting", async () => {
    const { server, record } = app(rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: true, legacyHeaders: false }));
    for (let i = 0; i < 2; i++) await request(server).post("/funnel-events").set("User-Agent", BROWSER).send(event).expect(204);
    await request(server).post("/funnel-events").set("User-Agent", BROWSER).send(event).expect(429);
    expect(record).toHaveBeenCalledTimes(2);
  });

  it("is reachable through the app without authentication or consent", async () => {
    const record = vi.fn(async () => undefined);
    const server = createApp({ config: createTestConfig(), services: { funnelEventsService: { record } as unknown as FunnelEventsService } });
    await request(server).post("/api/v1/funnel-events").set("User-Agent", BROWSER).send(event).expect(204);
    expect(record).toHaveBeenCalledTimes(1);
  });
});

describe("FunnelEventsService", () => {
  it("passes an absent detail and utm_source as null", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    await new FunnelEventsService({ rpc } as never, { error: vi.fn() }).record({ event: "landing_view", locale: "en", device: "mobile" });
    expect(rpc).toHaveBeenCalledWith("bump_funnel_event", { p_event: "landing_view", p_detail: null, p_locale: "en", p_device: "mobile", p_utm_source: null });
  });

  it("never throws and logs only a code when counting fails", async () => {
    const error = vi.fn();
    const failing = vi.fn(async () => ({ error: { message: "boom" } }));
    const throwing = vi.fn(async () => { throw new Error("offline"); });
    await new FunnelEventsService({ rpc: failing } as never, { error }).record({ event: "landing_view", locale: "en", device: "mobile" });
    await new FunnelEventsService({ rpc: throwing } as never, { error }).record({ event: "landing_view", locale: "en", device: "mobile" });
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith({ code: "FUNNEL_EVENT_NOT_COUNTED" }, "Funnel event was not counted");
  });
});

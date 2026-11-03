import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app/create-app";
import { createMarketingRouter } from "../src/modules/marketing/marketing.routes";
import { MarketingService } from "../src/modules/marketing/marketing.service";
import { createTestConfig } from "./helpers/in-memory";

const TOKEN = "a".repeat(48);

function app(limiter: express.RequestHandler = (_req, _res, next) => next()) {
  const unsubscribe = vi.fn(async () => undefined);
  const server = express();
  server.use(express.json());
  server.use(createMarketingRouter({ unsubscribe } as unknown as MarketingService, limiter));
  server.use((err: { statusCode?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.statusCode ?? 500).json({});
  });
  return { server, unsubscribe };
}

// A stand-in for the Supabase update chain that applies the filters to one preferences row.
function preferencesDb(row: { unsubscribe_token: string; opted_out_at: string | null }, error: { message: string } | null = null) {
  const calls: Array<{ payload: Record<string, unknown>; filters: Array<[string, unknown]> }> = [];
  const from = vi.fn((table: string) => {
    expect(table).toBe("marketing_email_preferences");
    const call = { payload: {} as Record<string, unknown>, filters: [] as Array<[string, unknown]> };
    calls.push(call);
    const chain = {
      update(payload: Record<string, unknown>) { call.payload = payload; return chain; },
      eq(key: string, value: unknown) { call.filters.push([key, value]); return chain; },
      is(key: string, value: unknown) { call.filters.push([key, value]); return chain; },
      then(resolve: (value: { error: { message: string } | null }) => unknown) {
        const matches = call.filters.every(([key, value]) => (row as Record<string, unknown>)[key] === value);
        if (!error && matches) Object.assign(row, call.payload);
        return Promise.resolve({ error }).then(resolve);
      },
    };
    return chain;
  });
  return { db: { from } as never, from, calls };
}

describe("POST /marketing/unsubscribe", () => {
  it("answers 200 { ok: true } and passes the trimmed token to the service", async () => {
    const { server, unsubscribe } = app();
    const response = await request(server).post("/marketing/unsubscribe").send({ token: ` ${TOKEN} ` }).expect(200);
    expect(response.body).toEqual({ success: true, data: { ok: true } });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(unsubscribe).toHaveBeenCalledWith(TOKEN);
  });

  it("answers the same for an unknown or malformed token", async () => {
    const { server } = app();
    const known = await request(server).post("/marketing/unsubscribe").send({ token: TOKEN }).expect(200);
    const unknown = await request(server).post("/marketing/unsubscribe").send({ token: "not-a-token" }).expect(200);
    expect(unknown.body).toEqual(known.body);
  });

  it.each([[{}], [{ token: "" }], [{ token: 42 }], [{ token: "x".repeat(257) }]])("rejects a body without a usable token (%j)", async (body) => {
    const { server, unsubscribe } = app();
    await request(server).post("/marketing/unsubscribe").send(body).expect(400);
    expect(unsubscribe).not.toHaveBeenCalled();
  });

  it("applies the per-IP limiter before the service", async () => {
    const { server, unsubscribe } = app(rateLimit({ windowMs: 60_000, limit: 2, standardHeaders: true, legacyHeaders: false }));
    for (let i = 0; i < 2; i++) await request(server).post("/marketing/unsubscribe").send({ token: TOKEN }).expect(200);
    await request(server).post("/marketing/unsubscribe").send({ token: TOKEN }).expect(429);
    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });

  it("is reachable through the app without authentication", async () => {
    const unsubscribe = vi.fn(async () => undefined);
    const server = createApp({ config: createTestConfig(), services: { marketingService: { unsubscribe } as unknown as MarketingService } });
    const response = await request(server).post("/api/v1/marketing/unsubscribe").send({ token: TOKEN }).expect(200);
    expect(response.body.data).toEqual({ ok: true });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("MarketingService.unsubscribe", () => {
  it("sets opted_out_at once and keeps the first value", async () => {
    const row = { unsubscribe_token: TOKEN, opted_out_at: null as string | null };
    const { db, calls } = preferencesDb(row);
    const service = new MarketingService(db, { error: vi.fn() });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-04T08:00:00Z"));
      await service.unsubscribe(TOKEN);
      vi.setSystemTime(new Date("2026-11-04T09:00:00Z"));
      await service.unsubscribe(TOKEN);
    } finally {
      vi.useRealTimers();
    }
    expect(row.opted_out_at).toBe("2026-11-04T08:00:00.000Z");
    expect(calls[0].filters).toEqual([["unsubscribe_token", TOKEN], ["opted_out_at", null]]);
  });

  it("does not query the database for a malformed token", async () => {
    const { db, from } = preferencesDb({ unsubscribe_token: TOKEN, opted_out_at: null });
    await new MarketingService(db, { error: vi.fn() }).unsubscribe("../../etc");
    await new MarketingService(db, { error: vi.fn() }).unsubscribe(TOKEN.toUpperCase());
    expect(from).not.toHaveBeenCalled();
  });

  it("treats an unknown token as a no-op", async () => {
    const row = { unsubscribe_token: TOKEN, opted_out_at: null as string | null };
    const { db } = preferencesDb(row);
    await new MarketingService(db, { error: vi.fn() }).unsubscribe("b".repeat(48));
    expect(row.opted_out_at).toBeNull();
  });

  it("surfaces a database failure and logs only a code", async () => {
    const error = vi.fn();
    const { db } = preferencesDb({ unsubscribe_token: TOKEN, opted_out_at: null }, { message: "boom" });
    await expect(new MarketingService(db, { error }).unsubscribe(TOKEN)).rejects.toMatchObject({ statusCode: 500 });
    expect(error).toHaveBeenCalledWith({ code: "MARKETING_UNSUBSCRIBE_FAILED" }, "Marketing unsubscribe was not saved");
    expect(JSON.stringify(error.mock.calls)).not.toContain(TOKEN);
  });
});

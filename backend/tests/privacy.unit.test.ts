import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { privacyConfig, NOTICE_VERSION } from "../src/modules/privacy/privacy.config";
import { requireFreshAuthentication } from "../src/modules/privacy/reauthentication";
import { AiService } from "../src/modules/ai/ai.service";
import { ForbiddenError } from "../src/shared/errors/app-error";
import { PrivacyService } from "../src/modules/privacy/privacy.service";
import { GuestImportsService } from "../src/modules/guest-imports/guest-imports.service";
import { createPrivacyRouter } from "../src/modules/privacy/privacy.routes";
import { ImportsService } from "../src/modules/imports/imports.service";
import type { ImportsRepository } from "../src/modules/imports/imports.repository";
import type { MasterCvRepository } from "../src/modules/master-cv/master-cv.repository";
import type { CvParser, ParseCvFileResult } from "../src/modules/imports/parsers/cv-parser";
import type { AiProvider } from "../src/modules/ai/provider/ai-provider";

afterEach(() => vi.unstubAllEnvs());
const processor = (id: string) => ({ id, name: id, purpose: "test", countries: "test", retention: "test", safeguards: "test" });
function approved() {
  vi.stubEnv("PRIVACY_REVIEW_APPROVED", "true"); vi.stubEnv("PRIVACY_CONTROLLER_NAME", "Test operator");
  vi.stubEnv("PRIVACY_CONTROLLER_ADDRESS", "Test address"); vi.stubEnv("PRIVACY_CONTACT_EMAIL", "privacy@example.invalid");
  vi.stubEnv("AI_PROVIDER", "openai"); vi.stubEnv("PRIVACY_AI_PROVIDER_APPROVED", "true");
  vi.stubEnv("PRIVACY_PROCESSORS_JSON", JSON.stringify([processor("supabase"), processor("vercel"), processor("openai")]));
}
function jwt(sub: string, method: string, timestamp: number, iat = Date.now() / 1000) {
  return `header.${Buffer.from(JSON.stringify({ sub, iat, amr: [{ method, timestamp }] })).toString("base64url")}.signature`;
}
describe("privacy release and permissions", () => {
  it("fails closed without verified identity/arrangements and binds AI approval to its actual provider", () => {
    vi.stubEnv("PRIVACY_REVIEW_APPROVED", "false"); expect(privacyConfig().collection_enabled).toBe(false);
    approved(); expect(privacyConfig().collection_enabled).toBe(true); expect(privacyConfig().ai_enabled).toBe(true);
    expect(privacyConfig().analytics_enabled).toBe(false);
    vi.stubEnv("AI_PROVIDER", "gemini"); expect(privacyConfig().ai_enabled).toBe(false);
    vi.stubEnv("PRIVACY_PROCESSORS_JSON", "invalid"); expect(privacyConfig().collection_enabled).toBe(false);
  });
  it("uses actual password/OAuth authentication time, not the refreshed JWT issue time", () => {
    const id = randomUUID(); const now = Date.now();
    expect(() => requireFreshAuthentication(jwt(id, "password", now / 1000), id, now)).not.toThrow();
    expect(() => requireFreshAuthentication(jwt(id, "oauth", now / 1000), id, now)).not.toThrow();
    expect(() => requireFreshAuthentication(jwt(id, "password", (now - 600_000) / 1000), id, now)).toThrow();
    expect(() => requireFreshAuthentication(jwt(id, "token_refresh", now / 1000), id, now)).toThrow();
    expect(() => requireFreshAuthentication(jwt(randomUUID(), "oauth", now / 1000), id, now)).toThrow();
    expect(() => requireFreshAuthentication(jwt(id, "oauth", (now + 600_000) / 1000), id, now)).toThrow();
  });
  it("parses a guest CV without calling an external provider when AI is declined", async () => {
    const parsed = { parserName: "local", parsedContent: { schema_version: "1.0", language: "en", metadata: {}, sections: [] }, rawExtractedText: "CV", warnings: [] } as unknown as ParseCvFileResult;
    const parser = { parse: vi.fn(async () => parsed) } as unknown as CvParser;
    const provider = { generate: vi.fn(), providerName: "openai" } as unknown as AiProvider;
    const service = new ImportsService({} as ImportsRepository, {} as MasterCvRepository, parser, provider);
    const result = await service.parseGuestFile({ bytes: Buffer.from("%PDF"), originalFilename: "cv.pdf", mimeType: "application/pdf", sizeBytes: 4 }, false);
    expect(result.parserName).toBe("local"); expect(provider.generate).not.toHaveBeenCalled();
  });
  it("blocks guest upload without AI permission before issuing a signed URL", async () => {
    approved();
    const createSignedUploadUrl = vi.fn(); const create = vi.fn();
    const privacy = { assertCollection: vi.fn(async () => undefined) };
    const service = new GuestImportsService({ create } as any, { createSignedUploadUrl } as any, {} as any, privacy as any);
    await expect(service.create({ notice_version: NOTICE_VERSION, ai_processing: false, analytics: false, original_filename: "cv.pdf", mime_type: "application/pdf", size_bytes: 20 })).rejects.toThrow("Enable AI");
    expect(createSignedUploadUrl).not.toHaveBeenCalled(); expect(create).not.toHaveBeenCalled();
  });
  it("blocks guest analysis and claim after withdrawal without touching storage or acquiring a lease", async () => {
    approved(); const id = randomUUID(); const token = "t".repeat(43);
    const { createHash } = await import("node:crypto");
    const row = { id, token_hash: createHash("sha256").update(token).digest("hex"), expires_at: new Date(Date.now()+86_400_000).toISOString(), claimed_user_id: null, ai_processing: false, status: "parsed" };
    const acquireLease = vi.fn(); const claim = vi.fn(); const downloadStorageObject = vi.fn();
    const service = new GuestImportsService({ find: async () => row, acquireLease, claim } as any, { downloadStorageObject } as any, {} as any, { assertGuestAvailable: async () => undefined } as any);
    await expect(service.process(id,token)).rejects.toThrow("Enable AI");
    await expect(service.claim(id,token,randomUUID())).rejects.toThrow("Enable AI");
    expect(acquireLease).not.toHaveBeenCalled(); expect(downloadStorageObject).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled();
  });
  it("requires approved AI before opening the AI-dependent upload journey", () => {
    approved(); expect(privacyConfig().ai_required).toBe(true);
    vi.stubEnv("PRIVACY_AI_PROVIDER_APPROVED", "false"); expect(privacyConfig().collection_enabled).toBe(false);
    vi.stubEnv("PRIVACY_AI_REQUIRED", "false"); expect(privacyConfig().collection_enabled).toBe(true);
  });
  it("does not substitute local parsing when AI is required but permission is missing", async () => {
    approved(); const parse = vi.fn();
    const service = new ImportsService({} as any, {} as any, { parse } as any, undefined, undefined, undefined, undefined, { aiPermission: async () => false } as any);
    await expect(service.parseGuestFile({ bytes: Buffer.from("%PDF"), originalFilename: "cv.pdf", mimeType: "application/pdf", sizeBytes: 4 }, false)).rejects.toThrow("Enable AI");
    expect(parse).not.toHaveBeenCalled();
  });
  it("reports failed AI analysis instead of silently completing with a local score", async () => {
    approved();
    const parse = vi.fn(); const permission = vi.fn(async () => undefined);
    const generate = vi.fn(async () => { throw new Error("provider unavailable"); });
    const parser = { parse, extractRawText: async () => ({ parserName: "local-extraction", rawExtractedText: "Readable CV", warnings: [] }) };
    const provider = { providerName: "openai", resolveModelName: () => "test", generate };
    const prompts = { resolve: async () => ({ prompt_key: "cv_parse", prompt_version: "test", system_prompt: "Parse CV", model_name: "test" }) };
    const service = new ImportsService({} as any, {} as any, parser as any, provider as any, prompts as any, undefined, undefined, {} as any);
    await expect(service.parseGuestFile({ bytes: Buffer.from("%PDF"), originalFilename: "cv.pdf", mimeType: "application/pdf", sizeBytes: 4 }, true, permission)).rejects.toThrow("AI analysis could not be completed");
    expect(permission).toHaveBeenCalled(); expect(generate).toHaveBeenCalledOnce(); expect(parse).not.toHaveBeenCalled();
  });
  it("rejects direct AI service calls before creating a run or contacting a provider", async () => {
    const generate = vi.fn(); const createRun = vi.fn();
    const privacy = { assertAi: vi.fn(async () => { throw new ForbiddenError("AI permission required"); }) };
    const service = new AiService({ createRun } as any, { generate } as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, privacy as any);
    const session = { appUser: { id: randomUUID() } } as any;
    await expect(service.parseCvContent(session, { raw_text: "Private CV", source_filename: "cv.pdf", mime_type: "application/pdf", language_hint: "en" })).rejects.toThrow("permission required");
    await expect(service.startTailoringRun(session, {} as any)).rejects.toThrow("permission required");
    expect(generate).not.toHaveBeenCalled(); expect(createRun).not.toHaveBeenCalled();
  });
  it("keeps AI and analytics independent while a reviewed provider is paused", async () => {
    approved(); vi.stubEnv("PRIVACY_AI_PROVIDER_APPROVED", "false"); const rpc = vi.fn(async (_name: string, _args: Record<string, any>) => ({ error: null }));
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { ai_processing: true, ai_provider: "openai", ai_notice_version: NOTICE_VERSION }, error: null }) };
    const service = new PrivacyService({ from: () => query, rpc } as unknown as SupabaseClient, null, { error: vi.fn() });
    await service.record(randomUUID(),null,{ notice_version: NOTICE_VERSION, ai_processing: true, analytics: false });
    expect(rpc.mock.calls[0][1].p_ai).toBe(true);
    vi.stubEnv("AI_PROVIDER","gemini"); await expect(service.record(randomUUID(),null,{ notice_version: NOTICE_VERSION, ai_processing: true, analytics: false })).rejects.toThrow("unavailable");
  });
  it("blocks provider access after withdrawal or permission generation changes", async () => {
    approved(); let enabled = false; let revision = 1;
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { ai_processing: enabled, ai_provider: "openai", ai_notice_version: NOTICE_VERSION, analytics: false, privacy_revision: revision }, error: null }) };
    const service = new PrivacyService({ from: () => query } as unknown as SupabaseClient, null, { error: vi.fn() });
    await expect(service.assertAi(randomUUID())).rejects.toThrow("Enable AI");
    enabled = true; expect(await service.assertAi(randomUUID())).toBe(1);
    revision = 2; await expect(service.assertAiUnchanged(randomUUID(), 1)).rejects.toThrow("discarded");
    vi.stubEnv("AI_PROVIDER", "anthropic"); await expect(service.assertAi(randomUUID())).rejects.toThrow("unavailable");
  });
});

describe("privacy endpoints", () => {
  function app() {
    const fake = { config: () => privacyConfig(), health: async () => ({ overdue: false, failures: 0 }), preferences: vi.fn(async () => ({ ai_processing: false, analytics: false, privacy_revision: 0 })), record: vi.fn(async () => undefined), requestDeletion: vi.fn(async () => ({ status: "deletion_requested" })) };
    const server = express(); server.use(express.json());
    server.use(createPrivacyRouter(fake as unknown as PrivacyService, (req, res, next) => {
      if (!req.get("Authorization")) { res.sendStatus(401); return; }
      req.auth = { appUser: { id: "owner" }, authUser: { auth_user_id: "auth-owner" } } as any; next();
    }));
    server.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode ?? 500).json({ message: err.message }));
    return { server, fake };
  }
  it("allows public notice config but protects preferences and deletion", async () => {
    const { server, fake } = app();
    await request(server).get("/privacy/config").expect(200).expect("Cache-Control", "no-store");
    await request(server).get("/me/privacy").expect(401);
    await request(server).post("/me/privacy/deletion").send({ confirmation: "DELETE" }).expect(401);
    expect(fake.requestDeletion).not.toHaveBeenCalled();
  });
  it("rejects stale reauthentication before requesting deletion", async () => {
    const { server, fake } = app();
    await request(server).post("/me/privacy/deletion").set("Authorization", `Bearer ${jwt("auth-owner", "password", Date.now() / 1000 - 3600)}`).send({ confirmation: "DELETE" }).expect(401);
    expect(fake.requestDeletion).not.toHaveBeenCalled();
    await request(server).post("/me/privacy/deletion").set("Authorization", `Bearer ${jwt("auth-owner", "oauth", Date.now() / 1000)}`).send({ confirmation: "DELETE" }).expect(202);
    expect(fake.requestDeletion).toHaveBeenCalledTimes(1);
  });
  it("records validated independent choices, rejecting arbitrary ownership fields", async () => {
    const { server, fake } = app(); const choices = { notice_version: NOTICE_VERSION, ai_processing: false, analytics: true };
    await request(server).patch("/me/privacy").set("Authorization", "Bearer authenticated").send({ ...choices, user_id: "other" }).expect(400);
    expect(fake.record).not.toHaveBeenCalled();
    await request(server).patch("/me/privacy").set("Authorization", "Bearer authenticated").send(choices).expect(200);
    expect(fake.record).toHaveBeenCalledWith("owner", null, choices);
  });
});

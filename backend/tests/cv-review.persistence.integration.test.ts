import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { SupabaseImportsRepository } from "../src/modules/imports/imports.repository";
import { SupabaseTailoredCvRepository } from "../src/modules/tailored-cv/tailored-cv.repository";
import { reviewCv, reviewTailoring } from "../src/modules/cv-review/cv-review";
import type { ImportReviewContext } from "../src/modules/cv-review/cv-review.types";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";

const content: CvContent = { version: "v1", language: "en", metadata: { source: "upload" }, sections: [{
  id: "experience", type: "experience", title: "Experience", order: 0, meta: {}, blocks: [{
    id: "block", type: "experience", order: 0, visibility: "visible", meta: {},
    fields: { description: "Built Python reporting tools for 200 users and reduced errors by 20%." }
  }]
}] };
const context: ImportReviewContext = { warnings: [], diagnostics: {
  mime_type: "application/pdf", attempted_stages: ["pdfjs_text"], final_stage: "pdfjs_text",
  quality: { score: 100, confidence: "high", low_confidence: false, natural_language_ratio: 1, symbol_ratio: 0, repeated_token_ratio: 0, entropy_ratio: 1 }
} };
const rawText = "Built Python reporting tools for 200 users and reduced errors by 20%.";
const comparison = reviewTailoring(content, content, { job_title: "Engineer", job_description: "Python reporting tools" });

function database(table: "imports" | "tailored_cvs", migrated = false) {
  const column = table === "imports" ? "review_context" : "tailoring_review";
  let row: Record<string, unknown> = { id: "record", user_id: "owner", source_file_id: "file", status: "uploaded", module_type: "standard", parsed_content: null, current_content: content, is_deleted: false };
  let available = migrated;
  let forcedError: { code: string; message: string } | null = null;
  let fallbackError = false;
  const requests: { method: string; url: URL; payload: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const payload = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ method, url, payload });
    const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url.pathname.endsWith("/files")) return response([{ id: "file", user_id: "owner", mime_type: "application/pdf" }]);
    if (method === "POST") { row = { ...row, ...payload }; return response(row, 201); }
    if (method === "PATCH") {
      if (forcedError) return response(forcedError, 400);
      if (!available && Object.prototype.hasOwnProperty.call(payload, column)) {
        return response({ code: "PGRST204", message: `Could not find the '${column}' column of '${table}' in the schema cache` }, 400);
      }
      if (fallbackError) return response({ code: "42501", message: "permission denied" }, 403);
      if (url.searchParams.get("user_id") !== `eq.${row.user_id}` || url.searchParams.get("id") !== `eq.${row.id}`) return response(null);
      row = { ...row, ...payload };
      return response(row);
    }
    return response(url.searchParams.get("user_id") === `eq.${row.user_id}` ? [row] : []);
  });
  const client = createClient("https://database.example.com", "test-key", { global: { fetch }, auth: { persistSession: false, autoRefreshToken: false } });
  return { client, requests, row: () => row, migrate: () => { available = true; }, fail: (error: typeof forcedError) => { forcedError = error; }, failFallback: () => { fallbackError = true; } };
}

describe("CV review persistence during schema rollout", () => {
  it("starts parsing without the new column, then persists evidence across fresh repository instances", async () => {
    const db = database("imports");
    const repo = new SupabaseImportsRepository(db.client);
    expect((await repo.updateImport("owner", "record", { status: "parsing", review_context: null }))?.status).toBe("parsing");
    const parsed = await repo.updateImport("owner", "record", { status: "parsed", parsed_content: content, raw_extracted_text: rawText, review_context: context });
    expect(parsed?.review_context).toEqual(context);
    expect(parsed?.parsed_content).toEqual(content);
    expect((db.row().parsed_content as CvContent).metadata.__server_review_context).toEqual(context);
    const cold = await new SupabaseImportsRepository(db.client).findImportDetailById("owner", "record");
    expect(cold?.importRow.review_context).toEqual(context);
    expect(cold?.importRow.parsed_content).toEqual(content);
    for (const request of db.requests.filter(r => r.url.pathname.endsWith("/imports"))) {
      expect(request.url.searchParams.get("id")).toBe("eq.record");
      expect(request.url.searchParams.get("user_id")).toBe("eq.owner");
    }
  });

  it("preserves poor extraction evidence through editor saves and ignores forged metadata", async () => {
    const db = database("imports");
    const repo = new SupabaseImportsRepository(db.client);
    const poor = { ...context, diagnostics: { ...context.diagnostics!, final_stage: "pdf_ocr_tesseract" as const } };
    await repo.updateImport("owner", "record", { status: "parsed", parsed_content: content, raw_extracted_text: rawText, review_context: poor });
    const edited = await new SupabaseImportsRepository(db.client).updateImport("owner", "record", { status: "reviewed", parsed_content: { ...content, metadata: { __server_review_context: null } } });
    expect(edited?.review_context).toEqual(poor);
    expect(edited?.parsed_content?.metadata).toEqual({});
    expect(reviewCv({ content: edited!.parsed_content, import_status: edited!.status, raw_text: edited!.raw_extracted_text, diagnostics: edited!.review_context!.diagnostics }).score).toBeNull();
  });

  it("clears fallback evidence on reparse and removes stale content after failure", async () => {
    const db = database("imports");
    const repo = new SupabaseImportsRepository(db.client);
    await repo.updateImport("owner", "record", { status: "parsed", parsed_content: content, review_context: context });
    const restarted = await repo.updateImport("owner", "record", { status: "parsing", review_context: null });
    expect(restarted?.review_context).toBeNull();
    expect((db.row().parsed_content as CvContent).metadata.__server_review_context).toBeUndefined();
    const failed = await repo.updateImport("owner", "record", { status: "failed", parsed_content: null, raw_extracted_text: null, review_context: null });
    expect(failed?.parsed_content).toBeNull();
    expect(failed?.review_context).toBeNull();
  });

  it("uses the real column without fallback when the migration is present", async () => {
    const db = database("imports", true);
    const saved = await new SupabaseImportsRepository(db.client).updateImport("owner", "record", { parsed_content: content, review_context: context });
    expect(saved?.review_context).toEqual(context);
    expect(db.requests.filter(r => r.method === "PATCH")).toHaveLength(1);
    expect(db.row().review_context).toEqual(context);
    expect((db.row().parsed_content as CvContent).metadata).toEqual(content.metadata);
  });

  it("promotes saved fallback evidence to the real column after migration", async () => {
    const db = database("imports");
    await new SupabaseImportsRepository(db.client).updateImport("owner", "record", { parsed_content: content, review_context: context });
    db.migrate();
    await new SupabaseImportsRepository(db.client).updateImport("owner", "record", { parsed_content: content });
    expect(db.row().review_context).toEqual(context);
    expect((db.row().parsed_content as CvContent).metadata).toEqual(content.metadata);
  });

  it.each([
    { code: "42501", message: "permission denied" },
    { code: "PGRST204", message: "Could not find the 'module_type' column of 'imports' in the schema cache" },
    { code: "PGRST204", message: "Could not find the 'review_context' column of 'other_table' in the schema cache" }
  ])("does not retry or hide unrelated failures: $message", async error => {
    const db = database("imports"); db.fail(error);
    await expect(new SupabaseImportsRepository(db.client).updateImport("owner", "record", { review_context: context, parsed_content: content })).rejects.toMatchObject({ details: { reason: error.message } });
    expect(db.requests.filter(r => r.method === "PATCH")).toHaveLength(1);
  });

  it("surfaces a failed fallback rather than reporting success", async () => {
    const db = database("imports"); db.failFallback();
    await expect(new SupabaseImportsRepository(db.client).updateImport("owner", "record", { parsed_content: content, review_context: context })).rejects.toMatchObject({ details: { reason: "permission denied" } });
    expect(db.requests.filter(r => r.method === "PATCH")).toHaveLength(2);
  });

  it("does not update another user's record while preserving evidence", async () => {
    const db = database("imports");
    const saved = await new SupabaseImportsRepository(db.client).updateImport("intruder", "record", { parsed_content: content });
    expect(saved).toBeNull();
    expect(db.requests.filter(r => r.method === "PATCH")).toHaveLength(0);
  });

  it("persists tailoring snapshots without the new column and keeps them through later edits", async () => {
    const db = database("tailored_cvs");
    const saved = await new SupabaseTailoredCvRepository(db.client).updateById("owner", "record", { current_content: content, tailoring_review: comparison });
    expect(saved?.tailoring_review).toEqual(comparison);
    expect(saved?.current_content).toEqual(content);
    const fresh = new SupabaseTailoredCvRepository(db.client);
    expect((await fresh.findById("owner", "record"))?.tailoring_review).toEqual(comparison);
    const edited = await fresh.updateById("owner", "record", { current_content: { ...content, metadata: { __server_tailoring_review: { score_change: 99 } } } });
    expect(edited?.tailoring_review).toEqual(comparison);
    expect(edited?.current_content.metadata).toEqual({});
    for (const request of db.requests) {
      expect(request.url.searchParams.get("user_id")).toBe("eq.owner");
      expect(request.url.searchParams.get("is_deleted")).toBe("eq.false");
    }
  });

  it("removes client-supplied review envelopes when creating a tailored CV", async () => {
    const db = database("tailored_cvs");
    const created = await new SupabaseTailoredCvRepository(db.client).create({ user_id: "owner", master_cv_id: "master", job_id: null, title: "CV", language: "en", template_id: null, module_type: "standard", status: "draft", current_content: { ...content, metadata: { __server_tailoring_review: { score_change: 99 } } } });
    expect(created.tailoring_review).toBeNull();
    expect((db.row().current_content as CvContent).metadata).toEqual({});
  });
});

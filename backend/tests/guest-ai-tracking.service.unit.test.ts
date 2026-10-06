import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AiProvider } from "../src/modules/ai/provider/ai-provider";
import { AiProviderError } from "../src/shared/errors/app-error";
import { trackedAiService } from "./helpers/tracked-ai-service";
import { ImportsService } from "../src/modules/imports/imports.service";

const input = { raw_text: "Synthetic CV for tracking tests", source_filename: "cv.pdf", mime_type: "application/pdf", language_hint: "en" };
const guest = () => ({ guest_import_id: randomUUID(), guest_lease_id: randomUUID() });
const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120 };
const output = { parsed_content: { version: "v1", language: "en", metadata: {}, sections: [] }, warnings: [] };
function provider(generate: AiProvider["generate"]): AiProvider {
  return { providerName: "openai", resolveModelName: () => "requested-model", generate };
}

describe("Tracked guest and import AI execution", () => {
  it("routes uploaded guest CV extraction through tracked execution", async () => {
    const tracked = trackedAiService(provider(async () => ({provider: "openai", model_name: "actual-model", output_payload: output, usage})));
    const parse = vi.fn();
    const parser = {parse, extractRawText: async () => ({parserName: "test-extractor", rawExtractedText: input.raw_text, warnings: []})};
    const imports = new ImportsService({} as any, {} as any, parser as any, undefined, undefined, tracked.service);
    const subject = guest();
    const result = await imports.parseGuestFile({bytes: Buffer.from("synthetic"), originalFilename: "cv.pdf", mimeType: "application/pdf", sizeBytes: 9}, true, async () => {}, subject);
    expect(result.parserName).toBe("openai_cv_parser_v1");
    expect([...tracked.runs.values()]).toEqual([expect.objectContaining({...subject, status: "completed", ...usage})]);
    expect(parse).not.toHaveBeenCalled();
  });

  it("blocks upload analysis when only an untracked provider is available", async () => {
    const generate = vi.fn(); const parse = vi.fn();
    const imports = new ImportsService({} as any, {} as any, {parse} as any, provider(generate));
    await expect(imports.parseGuestFile({bytes: Buffer.from("synthetic"), originalFilename: "cv.pdf", mimeType: "application/pdf", sizeBytes: 9}, true, async () => {}, guest())).rejects.toThrow("Tracked guest AI analysis is unavailable");
    expect(generate).not.toHaveBeenCalled(); expect(parse).not.toHaveBeenCalled();
  });

  it("creates a pending guest run before the call and records the existing prompt, lifecycle, output and actual usage", async () => {
    const subject = guest();
    const permission = vi.fn(async () => {});
    const tracked = trackedAiService(provider(async request => {
      const [pending] = [...tracked.runs.values()];
      expect(pending).toMatchObject({ user_id: null, ...subject, status: "pending", progress_stage: "calling_model", flow_type: "cv_parse" });
      expect(pending.input_payload).toHaveProperty("prompt.prompt_version");
      await request.onUsage?.({provider: "openai", model_name: "actual-model", usage});
      return {provider: "openai", model_name: "actual-model", usage, output_payload: output};
    }));
    const result = await tracked.service.parseGuestCvContent(subject, input, permission);
    expect(tracked.runs.size).toBe(1);
    expect(tracked.runs.get(result.ai_run_id)).toMatchObject({status: "completed", progress_stage: "completed", model_name: "actual-model", output_payload: output, ...usage});
    expect(permission.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("records failed attempts and retains token usage even when a billed response cannot be parsed", async () => {
    const tracked = trackedAiService(provider(async request => {
      await request.onUsage?.({provider: "openai", model_name: "actual-model", usage});
      throw new AiProviderError("Invalid provider output");
    }));
    await expect(tracked.service.parseGuestCvContent(guest(), input, async () => {})).rejects.toThrow();
    expect([...tracked.runs.values()]).toEqual([expect.objectContaining({status: "failed", output_payload: null, model_name: "actual-model", ...usage})]);
  });

  it("never starts a run or provider call without current guest permission", async () => {
    const generate = vi.fn();
    const tracked = trackedAiService(provider(generate));
    await expect(tracked.service.parseGuestCvContent(guest(), input, async () => {throw new Error("Permission denied");})).rejects.toThrow("Permission denied");
    expect(tracked.runs.size).toBe(0);
    expect(generate).not.toHaveBeenCalled();
  });

  it("discards late results after withdrawal while keeping already incurred usage", async () => {
    let permitted = true;
    const tracked = trackedAiService(provider(async request => {
      permitted = false;
      await request.onUsage?.({provider: "openai", model_name: "actual-model", usage});
      return {provider: "openai", model_name: "actual-model", output_payload: output, usage};
    }));
    await expect(tracked.service.parseGuestCvContent(guest(), input, async () => {if (!permitted) throw new Error("Permission changed");})).rejects.toThrow("Permission changed");
    expect([...tracked.runs.values()]).toEqual([expect.objectContaining({status: "failed", output_payload: null, ...usage})]);
  });

  it("does not recreate a guest run deleted during an outstanding provider call", async () => {
    let deleted = false;
    const tracked = trackedAiService(provider(async request => {
      deleted = true;
      tracked.runs.clear();
      await request.onUsage?.({provider: "openai", model_name: "actual-model", usage});
      return {provider: "openai", model_name: "actual-model", output_payload: output, usage};
    }));
    await expect(tracked.service.parseGuestCvContent(guest(), input, async () => {if (deleted) throw new Error("Guest deleted");})).rejects.toThrow("Guest deleted");
    expect(tracked.runs.size).toBe(0);
  });

  it("associates authenticated import parsing with the account and import", async () => {
    const tracked = trackedAiService(provider(async () => ({provider: "openai", model_name: "actual-model", output_payload: output, usage})));
    const userId = randomUUID(); const importId = randomUUID();
    const result = await tracked.service.parseCvContent({appUser: {id: userId}} as any, {...input, import_id: importId});
    expect(tracked.runs.get(result.ai_run_id)).toMatchObject({user_id: userId, import_id: importId, status: "completed", ...usage});
  });

  it("keeps all application provider calls inside the tracked AI service", () => {
    const root = resolve(__dirname, "../src");
    const callers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const path = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".ts") && /\b(?:this\.)?aiProvider\.generate\s*\(/.test(readFileSync(path, "utf8"))) callers.push(path);
      }
    };
    walk(root);
    expect(callers).toEqual([resolve(root, "modules/ai/ai.service.ts")]);
  });
});

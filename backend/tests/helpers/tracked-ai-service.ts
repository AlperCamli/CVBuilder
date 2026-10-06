import { randomUUID } from "node:crypto";
import { AiService } from "../../src/modules/ai/ai.service";
import type { AiRepository, AiRunOwner } from "../../src/modules/ai/ai.repository";
import type { AiProvider } from "../../src/modules/ai/provider/ai-provider";
import { AiPromptResolver } from "../../src/modules/ai/prompts/prompt-resolver";
import type { AiRunRecord } from "../../src/shared/types/domain";

// A stateful tracking port; the real service executes prompts, provider calls,
// permission checks, progress, validation and terminal-state persistence.
export function trackedAiService(provider: AiProvider, privacy?: any) {
  const runs = new Map<string, AiRunRecord>();
  const find = (owner: AiRunOwner, id: string) => {
    const row = runs.get(id);
    return row && (typeof owner === "string" ? row.user_id === owner : row.user_id === null && row.guest_import_id === owner.guest_import_id) ? row : null;
  };
  const repository: AiRepository = {
    async createRun(payload) {
      const run = { id: randomUUID(), master_cv_id: null, tailored_cv_id: null, job_id: null,
        status: "pending", progress_stage: "queued", output_payload: null, error_message: null,
        debug_payload: null, input_tokens: null, output_tokens: null, total_tokens: null,
        started_at: new Date().toISOString(), completed_at: null, ...payload } as AiRunRecord;
      runs.set(run.id, run); return run;
    },
    async updateRunProgressStage(owner, id, stage) {
      const row = find(owner, id); if (row?.status === "pending") row.progress_stage = stage; return row;
    },
    async recordRunUsage(owner, id, result) {
      const row = find(owner, id); if (row) Object.assign(row, {
        provider: result.provider, model_name: result.model_name,
        ...(result.usage ? result.usage : {})
      });
    },
    async completeRun(owner, id, output, usage) {
      const row = find(owner, id); if (row?.status !== "pending") return null;
      Object.assign(row, {status: "completed", progress_stage: "completed", output_payload: output,
        completed_at: new Date().toISOString(), ...(usage ?? {})}); return row;
    },
    async failRun(owner, id, error, debug) {
      const row = find(owner, id); if (row?.status !== "pending") return null;
      Object.assign(row, {status: "failed", progress_stage: "failed", error_message: error,
        debug_payload: debug ?? null, completed_at: new Date().toISOString()}); return row;
    },
    async findRunById(owner, id) { return find(owner, id); }
  } as AiRepository;
  const resolver = new AiPromptResolver({listActiveByProfile: async () => []}, "test");
  const service = new AiService(repository, provider, {} as any, {} as any, {} as any,
    {} as any, {} as any, resolver, {} as any, privacy);
  return { service, repository, runs };
}

import { describe, expect, it, vi } from "vitest";
import { SupabaseAiRepository } from "../src/modules/ai/ai.repository";

const usage = {provider: "openai", model_name: "actual-model", usage: {input_tokens: 100, output_tokens: 20, total_tokens: 120}};
function database(responses: Array<{data?: unknown; error?: unknown}>) {
  const queries: Array<{table: string; patch?: unknown; filters: unknown[]}> = [];
  const from = vi.fn((table: string) => {
    const record = {table, filters: [] as unknown[], patch: undefined as unknown};
    queries.push(record);
    const response = responses.shift() ?? {data: null, error: null};
    const chain = {
      update(patch: unknown) {record.patch = patch; return chain;},
      select() {return chain;},
      eq(key: string, value: unknown) {record.filters.push([key, value]); return chain;},
      is(key: string, value: unknown) {record.filters.push([key, value]); return chain;},
      async maybeSingle() {return response;},
      then(fulfilled: (result: unknown) => unknown) {return Promise.resolve(response).then(fulfilled);}
    };
    return chain;
  });
  return {repository: new SupabaseAiRepository({from} as any), queries};
}

describe("AI usage owner isolation", () => {
  it("scopes guest usage to the exact run and unclaimed guest", async () => {
    const db = database([{data: {id: "run"}}]);
    await db.repository.recordRunUsage({guest_import_id: "guest"}, "run", usage);
    expect(db.queries).toEqual([{table: "ai_runs", patch: {...usage.usage, provider: "openai", model_name: "actual-model"}, filters: [["id", "run"], ["user_id", null], ["guest_import_id", "guest"]]}]);
  });
  it("retains late usage after claim only for the matching account and import", async () => {
    const db = database([{data: null}, {data: {claimed_user_id: "owner", claimed_import_id: "import"}}, {data: null}]);
    await db.repository.recordRunUsage({guest_import_id: "guest"}, "run", usage);
    expect(db.queries[1]).toMatchObject({table: "guest_imports", filters: [["id", "guest"]]});
    expect(db.queries[2]).toMatchObject({table: "ai_runs", filters: [["id", "run"], ["user_id", "owner"], ["import_id", "import"]]});
    expect(db.queries[2].patch).not.toHaveProperty("output_payload");
  });
  it("does not recreate data after guest/run deletion", async () => {
    const db = database([{data: null}, {data: null}]);
    await db.repository.recordRunUsage({guest_import_id: "guest"}, "run", usage);
    expect(db.queries).toHaveLength(2);
    expect(db.queries[1].patch).toBeUndefined();
  });
  it("fails explicitly on accounting storage failure", async () => {
    const db = database([{error: {message: "unavailable"}}]);
    await expect(db.repository.recordRunUsage("owner", "run", usage)).rejects.toThrow("Failed to record AI usage");
    expect(db.queries[0].filters).toEqual([["id", "run"], ["user_id", "owner"]]);
  });
});

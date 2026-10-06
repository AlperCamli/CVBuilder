import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PrivacyService } from "../src/modules/privacy/privacy.service";

// Exercise the production maintenance/export/deletion service against a stateful
// port. SQL constraints, RPC atomicity and RLS are covered by privacy-controls.sql.
class Database {
  tables = new Map<string, any[]>(); objects = new Map<string, Uint8Array>(); failures = new Set<string>();
  remove = vi.fn(async (bucket: string, paths: string[]) => {
    if (paths.some(path => this.failures.has(`${bucket}/${path}`))) return { error: { message: "temporary failure" } };
    paths.forEach(path => this.objects.delete(`${bucket}/${path}`)); return { error: null };
  });
  auth = { admin: { signOut: vi.fn(async () => ({ error: null })), deleteUser: vi.fn(async () => ({ error: null as { code?: string; message: string } | null })) } };
  storage = { from: (bucket: string) => ({ remove: (paths: string[]) => this.remove(bucket, paths), download: async (path: string) => this.objects.has(`${bucket}/${path}`) ? { data: new Blob([new Uint8Array(this.objects.get(`${bucket}/${path}`)!)]), error: null } : { data: null, error: { message: "missing" } }, upload: async (path: string, bytes: Uint8Array | AsyncIterable<Uint8Array>) => { const chunks: Uint8Array[] = []; if (bytes instanceof Uint8Array) chunks.push(bytes); else for await (const chunk of bytes) chunks.push(chunk); this.objects.set(`${bucket}/${path}`, Buffer.concat(chunks)); return { error: null }; }, createSignedUrl: async (path: string, ttl: number) => ({ data: { signedUrl: `https://storage.example.invalid/${bucket}/${path}?ttl=${ttl}` }, error: null }) }) };
  table(name: string) { if (!this.tables.has(name)) this.tables.set(name, []); return this.tables.get(name)!; }
  from(name: string) { return new Query(this, name); }
  async rpc(name: string, args: any = {}) {
    if (name === "privacy_storage_inventory") {
      const files = this.table("files").filter(row => row.user_id === args.p_user).map(row => ({ bucket: row.storage_bucket, path: row.storage_path }));
      files.push(...this.table("guest_imports").filter(row => row.claimed_user_id === args.p_user).map(row => ({ bucket: "imports", path: row.storage_path })));
      files.push(...this.table("privacy_jobs").filter(row => row.subject_user_id === args.p_user && row.kind === "export").map(row => ({ bucket: "exports", path: row.storage_path ?? `privacy/${args.p_user}/${row.id}.zip` })));
      for (const key of this.objects.keys()) {
        const slash = key.indexOf("/"); const path = key.slice(slash + 1);
        if (path.startsWith(`users/${args.p_user}/`) || path.startsWith(`privacy/${args.p_user}/`)) files.push({ bucket: key.slice(0, slash), path });
      }
      const unique = [...new Map(files.map(file => [`${file.bucket}/${file.path}`, file])).values()].sort((a, b) => `${a.bucket}/${a.path}`.localeCompare(`${b.bucket}/${b.path}`));
      return { data: unique.slice(args.p_offset, args.p_offset + args.p_limit), error: null };
    }
    if (name === "acquire_privacy_job") {
      const row = this.table("privacy_jobs").find(row => row.id === args.p_id);
      if (!row || row.status === "complete" || Date.parse(row.retry_at) > Date.now() || (row.lease_until && Date.parse(row.lease_until) > Date.now())) return { data: false, error: null };
      Object.assign(row, { status: "working", lease_until: new Date(Date.now() + 300_000).toISOString(), attempts: row.attempts + 1 }); return { data: true, error: null };
    }
    if (name === "request_account_erasure") {
      const user = this.table("users").find(row => row.id === args.p_user);
      user.deletion_requested_at = new Date().toISOString();
      let job = this.table("privacy_jobs").find(row => row.subject_user_id === args.p_user && row.kind === "deletion");
      if (!job) { job = this.defaults({ subject_user_id: args.p_user, user_id: args.p_user, auth_user_id: args.p_auth, kind: "deletion" }); this.table("privacy_jobs").push(job); }
      return { data: job.id, error: null };
    }
    if (name === "count_guest_metrics") {
      const row = this.table("guest_imports").find(row => row.id === args.p_id);
      if (row.analytics && !row.deleted_at && !row.metrics_counted) { row.metrics_counted = true; this.table("onboarding_monthly_stats").push({ metric: "upload", count: 1 }); }
    }
    return { data: null, error: null };
  }
  defaults(input: any) { return { id: randomUUID(), created_at: new Date().toISOString(), status: "pending", step: "start", manifest: {}, attempts: 0, retry_at: new Date().toISOString(), lease_until: null, ...input }; }
}
class Query implements PromiseLike<any> {
  filters: ((row: any) => boolean)[] = []; action = "select"; payload: any; columns = "*"; count = false; limitCount = Infinity; offset = 0; singleRow = false;
  constructor(private db: Database, private name: string) {}
  select(columns = "*", options?: any) { this.columns = columns; this.count = !!options?.count; return this; }
  eq(key: string, value: any) { this.filters.push(row => row[key] === value); return this; }
  neq(key: string, value: any) { this.filters.push(row => row[key] !== value); return this; }
  is(key: string, value: any) { this.filters.push(row => (row[key] ?? null) === value); return this; }
  gt(key: string, value: any) { this.filters.push(row => row[key] > value); return this; }
  lt(key: string, value: any) { this.filters.push(row => row[key] != null && row[key] < value); return this; }
  lte(key: string, value: any) { this.filters.push(row => row[key] != null && row[key] <= value); return this; }
  in(key: string, values: any[]) { this.filters.push(row => values.includes(row[key])); return this; }
  or(value: string) { this.filters.push(row => value.split(",").some(condition => { const [key, op, ...parts] = condition.split("."); const compared = parts.join("."); return op === "not" ? row[key] != null : op === "is" ? row[key] == null : op === "lt" ? row[key] != null && row[key] < compared : row[key] != null && row[key] <= compared; })); return this; }
  order() { return this; }
  limit(value: number) { this.limitCount = value; return this; }
  range(start: number, end: number) { this.offset = start; this.limitCount = end - start + 1; return this; }
  single() { this.singleRow = true; return this; }
  maybeSingle() { this.singleRow = true; return this; }
  insert(payload: any) { this.action = "insert"; this.payload = payload; return this; }
  update(payload: any) { this.action = "update"; this.payload = payload; return this; }
  delete() { this.action = "delete"; return this; }
  then<TResult1 = any, TResult2 = never>(resolve?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null, reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    const table = this.db.table(this.name); let rows = table.filter(row => this.filters.every(filter => filter(row))); const count = rows.length;
    if (this.action === "insert") { rows = [this.db.defaults(this.payload)]; table.push(...rows); }
    if (this.action === "update") for (const row of rows) Object.assign(row, Object.fromEntries(Object.entries(this.payload).filter(([, value]) => value !== undefined)));
    if (this.action === "delete") for (const row of rows) table.splice(table.indexOf(row), 1);
    rows = rows.slice(this.offset, this.offset + this.limitCount).map(row => this.columns === "*" ? { ...row } : Object.fromEntries(this.columns.split(",").map(key => [key, row[key]])));
    return Promise.resolve({ data: this.singleRow ? rows[0] ?? null : rows, error: null, count: this.count ? count : null }).then(resolve, reject);
  }
}
function setup() {
  const db = new Database(); const userId = randomUUID();
  db.table("users").push({ id: userId, auth_user_id: randomUUID(), ai_processing: false, analytics: false, privacy_revision: 0 });
  db.table("privacy_cleanup_health").push({ id: true, initialized_at: new Date().toISOString(), last_success_at: null, backlog: 0, failures: 0 });
  const cancel = vi.fn(async () => undefined);
  const service = new PrivacyService(db as unknown as SupabaseClient, { cancelCustomerSubscriptions: cancel } as any, { error: vi.fn() });
  return { db, userId, service, cancel };
}
const guest = (extra: any = {}) => ({ id: randomUUID(), storage_path: `guests/${randomUUID()}/source.pdf`, expires_at: new Date(Date.now() - 1000).toISOString(), created_at: new Date(Date.now() - 86_400_000).toISOString(), claimed_user_id: null, deleted_at: null, delete_attempts: 0, analytics: false, ...extra });
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] })); afterEach(() => vi.useRealTimers());
describe("privacy maintenance", () => {
  it("cleans more than 100 expired uploads, preserving account-owned guest paths", async () => {
    const { db, service, userId } = setup();
    const rows = Array.from({ length: 121 }, () => guest()); const owned = guest({ claimed_user_id: userId });
    db.table("guest_imports").push(...rows, owned);
    for (const row of [...rows, owned]) db.objects.set(`imports/${row.storage_path}`, Buffer.from("CV"));
    db.table("files").push({ id: randomUUID(), user_id: userId, storage_bucket: "imports", storage_path: owned.storage_path });
    expect(await service.cleanup()).toBe(122); expect(db.table("guest_imports")).toHaveLength(0);
    expect(db.objects.size).toBe(1); expect(db.objects.has(`imports/${owned.storage_path}`)).toBe(true);
  });
  it("retains failed deletion metadata, schedules retries and reports failures", async () => {
    const { db, service } = setup(); const row = guest(); db.table("guest_imports").push(row); db.objects.set(`imports/${row.storage_path}`, Buffer.from("CV")); db.failures.add(`imports/${row.storage_path}`);
    expect(await service.cleanup()).toBe(0); expect(db.table("guest_imports")[0].delete_attempts).toBe(1);
    expect(db.table("privacy_cleanup_health")[0].failures).toBe(1);
    db.failures.clear(); vi.setSystemTime(Date.now() + 86_400_001); expect(await service.cleanup()).toBe(1);
  });
  it("rechecks deleted objects after the outstanding signed-upload window", async () => {
    const { db, service } = setup(); const row = guest({ deleted_at: new Date().toISOString(), created_at: new Date().toISOString() }); db.table("guest_imports").push(row);
    expect(await service.cleanup()).toBe(0); expect(db.table("guest_imports")).toHaveLength(1);
    db.objects.set(`imports/${row.storage_path}`, Buffer.from("late upload")); vi.setSystemTime(Date.now() + 3 * 3_600_000);
    expect(await service.cleanup()).toBe(1); expect(db.objects.size).toBe(0);
  });
  it("reports an overdue cleanup without pretending initialization is a successful run", async () => {
    const { service } = setup(); expect((await service.health()).overdue).toBe(false);
    vi.setSystemTime(Date.now() + 31 * 3_600_000); expect((await service.health()).overdue).toBe(true);
  });
});
describe("account privacy jobs", () => {
  it("blocks access immediately and retries physical deletion before removing database/Auth identities", async () => {
    const { db, service, userId, cancel } = setup(); const path = "users/test/cv.pdf";
    db.table("files").push({ id: randomUUID(), user_id: userId, storage_bucket: "imports", storage_path: path }); db.objects.set(`imports/${path}`, Buffer.from("CV"));
    db.table("subscriptions").push({ id: randomUUID(), user_id: userId, provider_customer_id: "cus_test" }); db.failures.add(`imports/${path}`);
    await service.requestDeletion(userId, "auth_test", "verified-token");
    await expect(service.preferences(userId)).rejects.toThrow("unavailable"); expect(cancel).toHaveBeenCalledWith("cus_test", expect.any(Number));
    expect(db.auth.admin.signOut).toHaveBeenCalledWith("verified-token", "global"); expect(db.auth.admin.deleteUser).not.toHaveBeenCalled(); expect(db.table("users")).toHaveLength(1);
    db.failures.clear(); vi.setSystemTime(Date.now() + 600_000); await service.cleanup();
    expect(db.table("users")).toHaveLength(0); expect(db.auth.admin.deleteUser).toHaveBeenCalledWith("auth_test");
    expect(db.table("privacy_jobs")[0].status).toBe("pending");
    vi.setSystemTime(Date.now() + 3 * 3_600_000); await service.cleanup(); expect(db.table("privacy_jobs")[0].status).toBe("complete"); expect(db.table("privacy_jobs")[0].manifest).toEqual({});
  });
  it("resumes deletion from its durable cursor after the execution budget is exhausted", async () => {
    const { db, service, userId } = setup();
    for (let index=0; index<121; index++) {
      const path = `users/${userId}/file-${index}.pdf`;
      db.table("files").push({ id: randomUUID(), user_id: userId, storage_bucket: "imports", storage_path: path }); db.objects.set(`imports/${path}`, Buffer.from("CV"));
    }
    let delayed = false;
    db.remove.mockImplementation(async (bucket, paths) => {
      paths.forEach(path => db.objects.delete(`${bucket}/${path}`));
      if (!delayed) { delayed=true; vi.setSystemTime(Date.now()+21_000); }
      return { error: null };
    });
    await service.requestDeletion(userId,"auth_test","verified-token");
    expect(db.table("privacy_jobs")[0].manifest.storage_cursor).toBe(50);
    expect(db.table("users")).toHaveLength(1); expect(db.auth.admin.deleteUser).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now()+2000); await service.cleanup();
    expect(db.table("users")).toHaveLength(0); expect(db.objects.size).toBe(0);
  });
  it("removes unregistered objects and a late upload during the final account sweep", async () => {
    const { db, service, userId } = setup(); const path=`imports/users/${userId}/orphan.pdf`;
    db.objects.set(path,Buffer.from("unregistered")); await service.requestDeletion(userId,"auth_test","verified-token");
    expect(db.objects.has(path)).toBe(false); db.objects.set(`imports/users/${userId}/late-orphan.pdf`,Buffer.from("late"));
    vi.setSystemTime(Date.now()+3*3_600_000); await service.cleanup(); expect(db.objects.size).toBe(0); expect(db.table("privacy_jobs")[0].status).toBe("complete");
  });
  it("includes account rows and file bytes in private ZIP exports and enforces ownership/expiry", async () => {
    const { db, service, userId } = setup(); const id = randomUUID();
    db.table("files").push({ id, user_id: userId, original_filename: "cv.pdf", storage_bucket: "imports", storage_path: "owned/cv.pdf" }); db.objects.set("imports/owned/cv.pdf", Buffer.from("CV bytes"));
    const job = await service.requestExport(userId); expect(job.status).toBe("complete");
    const path = `exports/privacy/${userId}/${job.id}.zip`; const zip = await JSZip.loadAsync(db.objects.get(path)!);
    expect(await zip.file(`files/${id}/cv.pdf`)!.async("string")).toBe("CV bytes"); expect(JSON.parse(await zip.file("data.json")!.async("string")).users[0].id).toBe(userId);
    db.table("users").push({ id: "other", ai_processing: false }); await expect(service.exportDownload("other", job.id)).rejects.toThrow("expired");
    expect((await service.exportDownload(userId, job.id)).url).toContain("ttl=300");
    vi.setSystemTime(Date.now() + 86_400_001); await expect(service.exportDownload(userId, job.id)).rejects.toThrow("expired"); await service.cleanup(); expect(db.objects.has(path)).toBe(false);
  });
});

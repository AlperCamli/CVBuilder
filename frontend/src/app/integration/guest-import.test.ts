import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./supabase-client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) }, storage: { from: () => ({ uploadToSignedUrl: async () => ({ error: null }) }) } } }));
import { clearGuestUpload, readGuestUpload, saveGuestAnswers, saveGuestUpload, uploadGuestCv, processGuestCv, type GuestUpload } from "./guest-import";

const row: GuestUpload = { id: "12345678-1234-1234-1234-123456789012", guest_token: "a".repeat(43),
  expires_at: new Date(Date.now() + 86_400_000).toISOString(), original_filename: "cv.pdf", answers: { career: "student" }, step: "questions", question: 1 };
let data: Map<string, string>;
beforeEach(() => {
  data = new Map();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
  vi.stubGlobal("window", { localStorage: storage }); vi.stubGlobal("localStorage", storage);
});
afterEach(() => vi.unstubAllGlobals());

describe("guest upload handoff", () => {
  it("starts analysis immediately and saves answers without waiting for it or starting a second run", async () => {
    let release: () => void = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url) => {
      const path = new URL(url).pathname;
      paths.push(path);
      let result: unknown;
      if (path.endsWith("/process")) { await pending; result = { status: "parsed" }; }
      else if (path.endsWith("/answers")) result = { saved: true };
      else result = { id: row.id, guest_token: row.guest_token, expires_at: row.expires_at, upload: { storage_bucket: "imports", storage_path: "fixture/cv.pdf", token: "fixture" } };
      return new Response(JSON.stringify({ success: true, data: result }), { headers: { "Content-Type": "application/json" } });
    }));
    const uploaded = await uploadGuestCv(new File(["%PDF-fixture"], "cv.pdf"), true);
    await vi.waitFor(() => expect(paths.some(path => path.endsWith("/process"))).toBe(true));
    const resumed = processGuestCv(uploaded);
    await saveGuestAnswers(uploaded, { career: "student" });
    expect(paths.filter(path => path.endsWith("/process"))).toHaveLength(1);
    expect(paths.some(path => path.endsWith("/answers"))).toBe(true);
    release();
    await expect(resumed).resolves.toMatchObject({ status: "parsed" });
  });
  it("preserves only the proof and cursor for refresh and auth redirects", () => {
    saveGuestUpload(row); expect(readGuestUpload()).toEqual({ ...row, answers: {}, original_filename: "Your CV" }); expect(localStorage.getItem("cv-builder:guest-import")).not.toContain("answers"); expect(localStorage.getItem("cv-builder:guest-import")).not.toContain("cv.pdf"); clearGuestUpload(); expect(readGuestUpload()).toBeNull();
  });
  it("discards expired, corrupt and malformed handoffs", () => {
    saveGuestUpload({ ...row, expires_at: new Date(0).toISOString() }); expect(readGuestUpload()).toBeNull(); expect(data.size).toBe(0);
    data.set("cv-builder:guest-import", "bad json"); expect(readGuestUpload()).toBeNull();
    data.set("cv-builder:guest-import", JSON.stringify({ ...row, guest_token: "invalid" })); expect(readGuestUpload()).toBeNull();
  });
  it("reports unavailable persistent storage before leaving for auth", () => {
    vi.stubGlobal("localStorage", { setItem: () => { throw new Error("storage blocked"); } });
    expect(() => saveGuestUpload(row)).toThrow("storage blocked");
  });
  it("serializes answer requests so earlier saves cannot overwrite newer answers", async () => {
    const bodies: unknown[] = []; let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      if (bodies.length === 1) await gate;
      return new Response(JSON.stringify({ success: true, data: { saved: true } }), { headers: { "Content-Type": "application/json" } });
    }));
    const first = saveGuestAnswers(row, { career: "student" });
    const second = saveGuestAnswers(row, { career: "experienced" });
    await vi.waitFor(() => expect(bodies.length).toBe(1));
    release(); await Promise.all([first, second]);
    expect(bodies).toEqual([{ career: "student" }, { career: "experienced" }]);
  });
});

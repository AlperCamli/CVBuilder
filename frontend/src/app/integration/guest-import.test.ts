import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./supabase-client", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
import { clearGuestUpload, readGuestUpload, saveGuestAnswers, saveGuestUpload, type GuestUpload } from "./guest-import";

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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNewCvOnboarding, completeNewCvOnboarding, readNewCvOnboarding, recordNewCvStart,
  saveNewCvOnboarding, type NewCvOnboarding,
} from "./new-cv-onboarding";
import { privacyApi } from "./privacy";
import type { BackendApi } from "./backend-api";

let storage: Map<string, string>;
const draft = (): NewCvOnboarding => ({
  id: "setup-1", expiresAt: Date.now() + 86_400_000, language: "en",
  answers: { goal: "tailor", career: "student" }, step: "signup", question: 3,
});
const createApi = () => ({
  patchOnboardingAnswers: vi.fn<BackendApi["patchOnboardingAnswers"]>().mockResolvedValue({ answers: {} }),
  createMasterCv: vi.fn<BackendApi["createMasterCv"]>().mockResolvedValue({ id: "new-cv" } as Awaited<ReturnType<BackendApi["createMasterCv"]>>),
});
beforeEach(() => {
  storage = new Map();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", { localStorage });
});
afterEach(() => vi.unstubAllGlobals());

describe("new CV onboarding handoff", () => {
  it("restores the questionnaire, language and cursor across signup redirects", () => {
    const row = { ...draft(), language: "tr" as const, step: "questions" as const, question: 1 };
    saveNewCvOnboarding(row);
    expect(readNewCvOnboarding()).toEqual(row);
    clearNewCvOnboarding();
    expect(readNewCvOnboarding()).toBeNull();
  });
  it("discards expired, malformed or non-questionnaire answers", () => {
    for (const row of [{ ...draft(), expiresAt: 0 }, { ...draft(), question: 4 }, { ...draft(), answers: { goal: "unrecognized" } }, { ...draft(), answers: { email: "private@example.invalid" } }]) {
      storage.set("cv-builder:new-cv-onboarding", JSON.stringify(row));
      expect(readNewCvOnboarding()).toBeNull();
      expect(storage.size).toBe(0);
    }
  });
  it("saves answers to the authenticated account and creates an empty CV once across effect replays and retries", async () => {
    const row = draft(), api = createApi();
    saveNewCvOnboarding(row);
    const first = completeNewCvOnboarding(row, "account-1", api);
    const replay = completeNewCvOnboarding(row, "account-1", api);
    expect(first).toBe(replay);
    await expect(first).resolves.toBe("new-cv");
    expect(api.patchOnboardingAnswers).toHaveBeenCalledWith(row.answers);
    expect(api.createMasterCv).toHaveBeenCalledExactlyOnceWith({ title: "My Main CV", language: "en" });
    await expect(completeNewCvOnboarding(row, "account-1", api)).resolves.toBe("new-cv");
    expect(api.createMasterCv).toHaveBeenCalledTimes(1);
    expect(readNewCvOnboarding()).toMatchObject({ accountId: "account-1", masterCvId: "new-cv" });
  });
  it("retains the handoff and retries after a failed answer save without creating a CV early", async () => {
    const row = draft(), api = createApi();
    saveNewCvOnboarding(row);
    api.patchOnboardingAnswers.mockRejectedValueOnce(new Error("offline"));
    await expect(completeNewCvOnboarding(row, "account-1", api)).rejects.toThrow("offline");
    expect(api.createMasterCv).not.toHaveBeenCalled();
    await expect(completeNewCvOnboarding(row, "account-1", api)).resolves.toBe("new-cv");
  });
  it("never replays one account's setup into another account", async () => {
    const row = draft(), api = createApi();
    saveNewCvOnboarding({ ...row, accountId: "account-1" });
    await expect(completeNewCvOnboarding(row, "account-2", api)).rejects.toThrow("another account");
    expect(api.patchOnboardingAnswers).not.toHaveBeenCalled();
    expect(api.createMasterCv).not.toHaveBeenCalled();
  });

  it("reports an anonymous start with only the path, ignoring failures and storing nothing", async () => {
    const post = vi.spyOn(privacyApi, "post").mockRejectedValue(new Error("offline"));
    saveNewCvOnboarding(draft());
    const stored = new Map(storage);
    expect(() => recordNewCvStart()).not.toThrow();
    await Promise.resolve();
    expect(post).toHaveBeenCalledWith("/onboarding/started", { path: "manual_create" }, { keepalive: true });
    expect(storage).toEqual(stored);
    post.mockRestore();
  });
});

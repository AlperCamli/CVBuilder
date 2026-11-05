import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingCheckout,
  readPendingCheckout,
  setPendingCheckout
} from "./pending-checkout";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("pending checkout", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: new MemoryStorage()
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores and loads the new checkout plans", () => {
    for (const planCode of ["weekly", "monthly", "annual"] as const) {
      setPendingCheckout({ plan_code: planCode, with_trial: planCode === "monthly" });

      expect(readPendingCheckout()).toEqual({
        plan_code: planCode,
        with_trial: planCode === "monthly"
      });
    }
  });

  it("resumes a weekly-trial intent stored before the switch as a Monthly trial", () => {
    window.localStorage.setItem(
      "cv-builder:pending-checkout",
      JSON.stringify({ plan_code: "weekly", with_trial: true, return_path: "/app/cv-score?action=editor", created_at: Date.now() })
    );

    expect(readPendingCheckout()).toEqual({ plan_code: "monthly", with_trial: true, return_path: "/app/cv-score?action=editor" });
  });

  it("treats a weekly record without the trial flag as the legacy trial intent, never a paid weekly resume", () => {
    window.localStorage.setItem("cv-builder:pending-checkout", JSON.stringify({ plan_code: "weekly", created_at: Date.now() }));
    expect(readPendingCheckout()).toEqual({ plan_code: "monthly", with_trial: true });
    window.localStorage.setItem("cv-builder:pending-checkout", JSON.stringify({ plan_code: "annual", created_at: Date.now() }));
    expect(readPendingCheckout()).toEqual({ plan_code: "annual", with_trial: undefined });
  });

  it("keeps an explicit paid Weekly choice as a paid Weekly checkout", () => {
    setPendingCheckout({ plan_code: "weekly", with_trial: false });

    expect(readPendingCheckout()).toEqual({ plan_code: "weekly", with_trial: false });
  });

  it("ignores hidden legacy checkout plans", () => {
    window.localStorage.setItem(
      "cv-builder:pending-checkout",
      JSON.stringify({ plan_code: "pro", with_trial: true })
    );

    expect(readPendingCheckout()).toBeNull();
  });

  it("clears the stored checkout intent", () => {
    setPendingCheckout({ plan_code: "annual" });
    clearPendingCheckout();

    expect(readPendingCheckout()).toBeNull();
  });
});

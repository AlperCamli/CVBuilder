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
      setPendingCheckout({ plan_code: planCode, with_trial: planCode === "weekly" });

      expect(readPendingCheckout()).toEqual({
        plan_code: planCode,
        with_trial: planCode === "weekly"
      });
    }
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

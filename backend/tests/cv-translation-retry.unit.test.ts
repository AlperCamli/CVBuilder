import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderError } from "../src/shared/errors/app-error";
import { retryTranslationBlock } from "../src/modules/ai/cv-translation-retry";

describe("translation retry delays", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("backs off and respects a provider retry-after hint", async () => {
    const start = Date.now();
    const times: number[] = [];
    const operation = vi.fn(async () => {
      times.push(Date.now() - start);
      if (times.length < 3) throw new AiProviderError("Rate limited", { provider_status: 429, provider_retry_delay_ms: 5_000 });
      return "translated";
    });
    const result = retryTranslationBlock(operation);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(operation).toHaveBeenCalledTimes(1);
    await vi.runAllTimersAsync();
    expect(await result).toBe("translated");
    expect(times).toEqual([0, 5_000, 10_000]);
  });

  it("uses increasing waits for failures without a retry hint", async () => {
    const times: number[] = [];
    const operation = vi.fn(async () => {
      times.push(Date.now());
      if (times.length < 3) throw new Error("Network unavailable");
      return "translated";
    });
    const result = retryTranslationBlock(operation);
    await vi.runAllTimersAsync();
    expect(await result).toBe("translated");
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(750);
    expect(times[1] - times[0]).toBeLessThanOrEqual(1_000);
    expect(times[2] - times[1]).toBeGreaterThanOrEqual(1_500);
    expect(times[2] - times[1]).toBeLessThanOrEqual(2_000);
  });

  it("stops rather than retrying earlier than a long provider cooldown allows", async () => {
    const operation = vi.fn(async () => { throw new AiProviderError("Rate limited", { provider_status: 429, provider_retry_delay_ms: 60_000 }); });
    await expect(retryTranslationBlock(operation)).rejects.toThrow("Rate limited");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});

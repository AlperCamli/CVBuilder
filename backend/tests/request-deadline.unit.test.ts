import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithRequestDeadline, withRequestDeadline } from "../src/shared/utils/request-deadline";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("maintenance transport deadline", () => {
  it("keeps response body aborts armed after headers and isolates concurrent ordinary requests", async () => {
    vi.useFakeTimers(); const signals: (AbortSignal | null | undefined)[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input, init) => { signals.push(init?.signal); return new Response("headers ready"); }));
    await Promise.all([withRequestDeadline(Date.now()+50, () => fetchWithRequestDeadline("https://fixture.invalid/maintenance")), fetchWithRequestDeadline("https://fixture.invalid/ordinary")]);
    expect(signals[0]?.aborted).toBe(false); expect(signals[1]).toBeUndefined();
    await vi.advanceTimersByTimeAsync(51); expect(signals[0]?.aborted).toBe(true);
  });
  it("preserves caller cancellation alongside the maintenance budget", async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_input, init) => { signal = init.signal; return new Response("fixture"); }));
    const caller = new AbortController();
    await withRequestDeadline(Date.now()+1000, () => fetchWithRequestDeadline("https://fixture.invalid", { signal: caller.signal }));
    caller.abort(); expect(signal?.aborted).toBe(true); await vi.advanceTimersByTimeAsync(1001);
  });
});

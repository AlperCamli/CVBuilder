import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createOnboardingSaver} from "./onboarding-saver";
import {ApiClientError} from "./api-error";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("onboarding database persistence", () => {
  it("supports React's effect cleanup and setup replay", async () => {
    const save = vi.fn().mockResolvedValue({});
    const saver = createOnboardingSaver(save, vi.fn());
    saver.activate(); saver.dispose(); saver.activate();
    saver.enqueue({onboarding_completed: true});
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledWith({onboarding_completed: true}); saver.dispose();
  });
  it("retries failed saves and merges later milestones without losing earlier progress", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue({}); const status = vi.fn();
    const saver = createOnboardingSaver(save, status);
    saver.enqueue({onboarding_state: {steps: {create_cv: "first"}}}); await vi.advanceTimersByTimeAsync(0);
    saver.enqueue({onboarding_state: {steps: {customize: "second"}}});
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenLastCalledWith({onboarding_state: {steps: {create_cv: "first", customize: "second"}}});
    expect(status).toHaveBeenLastCalledWith(null); saver.dispose();
  });
  it("stops retries when account authorization fails", async () => {
    const save = vi.fn().mockRejectedValue(new ApiClientError({status: 403, code: "FORBIDDEN", message: "unavailable"}));
    const saver = createOnboardingSaver(save, vi.fn()); saver.enqueue({onboarding_completed: true});
    await vi.advanceTimersByTimeAsync(120000); expect(save).toHaveBeenCalledTimes(1); saver.dispose();
  });
  it("does not replay one account's queued saves after disposal", async () => {
    const save = vi.fn().mockRejectedValue(new Error("offline"));
    const saver = createOnboardingSaver(save, vi.fn()); saver.enqueue({onboarding_completed: true});
    await vi.advanceTimersByTimeAsync(0); saver.dispose(); await vi.advanceTimersByTimeAsync(120000);
    saver.retry(); saver.enqueue({onboarding_completed: true}); expect(save).toHaveBeenCalledTimes(1);
  });
});

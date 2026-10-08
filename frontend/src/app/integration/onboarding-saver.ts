import type { UpdateSettingsInput } from "./backend-api";
import { ApiClientError } from "./api-error";

const merge = (older: UpdateSettingsInput, newer: UpdateSettingsInput): UpdateSettingsInput => ({
  ...older, ...newer,
  onboarding_state: {...older.onboarding_state, ...newer.onboarding_state,
    steps: {...older.onboarding_state?.steps, ...newer.onboarding_state?.steps}}
});

// This queue contains progress timestamps only, stays in memory, and is
// disposed on account change/unmount. It cannot replay one account's work into
// another account. Serialized partial patches preserve later milestones.
export function createOnboardingSaver(save: (patch: UpdateSettingsInput) => Promise<unknown>, status: (error: string | null) => void) {
  let pending: UpdateSettingsInput | null = null;
  let running = false, disposed = false, attempts = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = async () => {
    if (disposed || running || !pending) return;
    running = true;
    const patch = pending; pending = null;
    try {
      await save(patch);
      attempts = 0;
      if (!disposed) status(null);
    } catch (error) {
      if (disposed) return;
      pending = pending ? merge(patch, pending) : patch;
      status("Your setup progress could not be saved. We'll retry when connected; you can also retry now.");
      attempts++;
      const retryable = !(error instanceof ApiClientError) || error.status >= 500 || error.status === 429;
      if (retryable) timer = setTimeout(() => { timer = undefined; void flush(); }, Math.min(30_000, 2000 * 2 ** (attempts - 1)));
    } finally {
      running = false;
      if (!disposed && pending && !timer && attempts === 0) void flush();
    }
  };
  return {
    activate() { disposed = false; },
    enqueue(patch: UpdateSettingsInput) { if (disposed) return; pending = pending ? merge(pending, patch) : patch; if (!timer) void flush(); },
    retry() { if (timer) clearTimeout(timer); timer = undefined; attempts = 0; void flush(); },
    dispose() { disposed = true; pending = null; attempts = 0; if (timer) clearTimeout(timer); timer = undefined; }
  };
}

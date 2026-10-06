import { AsyncLocalStorage } from "node:async_hooks";

const deadlines = new AsyncLocalStorage<number>();

export function withRequestDeadline<T>(deadline: number, operation: () => Promise<T>): Promise<T> {
  return deadlines.run(deadline, operation);
}

// Scope only maintenance calls. Ordinary parsing/export requests retain their
// existing transport behavior; no deadline leaks into concurrent requests.
export const fetchWithRequestDeadline: typeof fetch = async (input, init) => {
  const deadline = deadlines.getStore();
  if (deadline === undefined) return fetch(input, init);
  const controller = new AbortController();
  const supplied = init?.signal ?? (input instanceof Request ? input.signal : null);
  const abort = () => controller.abort();
  if (supplied?.aborted || deadline <= Date.now()) abort();
  else supplied?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    abort(); supplied?.removeEventListener("abort", abort);
  }, Math.max(1, deadline - Date.now()));
  timer.unref();
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  catch (error) { clearTimeout(timer); supplied?.removeEventListener("abort", abort); throw error; }
  // Keep the abort timer after headers arrive: Storage response bodies may
  // still be downloading. It is unreferenced and releases its listener at expiry.
};

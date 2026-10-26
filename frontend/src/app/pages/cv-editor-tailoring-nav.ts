// Navigation helpers for tailoring inside the CV editor.

// A tailored copy created from the Tailor panel is handed to the next editor route as
// history state so the editor can switch to it in place. History state survives refresh
// and back/forward, so it is trusted only briefly and stripped once consumed; otherwise a
// stale snapshot could hydrate the editor and be autosaved over newer server content.
export const PRELOADED_TAILORED_MAX_AGE_MS = 30_000;

// Editor URL that reopens the Tailor panel without relying on history state (survives the
// external checkout redirect). The editor resolves the CV kind from the server.
export function tailoringReturnPath(cvId: string): string {
  return `/app/cv/${encodeURIComponent(cvId)}?tailor=1`;
}

export interface PreloadedTailoredResult<T> {
  // The preloaded detail, when it is for this route and fresh enough to trust.
  preloaded: T | null;
  // History state without the preload, when the current state carries one and must be replaced.
  strippedState: Record<string, unknown> | null;
}

export function takePreloadedTailored<T extends { id: string }>(
  state: unknown,
  routeId: string | undefined,
  now: number = Date.now()
): PreloadedTailoredResult<T> {
  if (!state || typeof state !== "object" || !("preloadedTailored" in state)) {
    return { preloaded: null, strippedState: null };
  }
  const { preloadedTailored, preloadedAt, ...rest } = state as Record<string, unknown>;
  const candidate = preloadedTailored as T | null | undefined;
  const age = typeof preloadedAt === "number" ? now - preloadedAt : Number.NaN;
  const fresh = age >= 0 && age <= PRELOADED_TAILORED_MAX_AGE_MS;
  const matches = Boolean(candidate && typeof candidate === "object" && routeId && candidate.id === routeId);
  return { preloaded: fresh && matches ? (candidate as T) : null, strippedState: rest };
}

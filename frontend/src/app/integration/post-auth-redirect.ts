// Destination to resume after an auth round-trip that can't carry router state
// (Google OAuth, email verification). Mirrors the PendingCheckoutIntent pattern:
// stashed in localStorage right before leaving the app, consumed once on return.

const STORAGE_KEY = "cv-builder:post-auth-redirect";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface PostAuthRedirectStash {
  path: string;
  created_at: number;
}

export const stashPostAuthRedirect = (path: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  const stash: PostAuthRedirectStash = { path, created_at: Date.now() };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stash));
};

export const consumePostAuthRedirect = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  window.localStorage.removeItem(STORAGE_KEY);

  try {
    const stash = JSON.parse(raw) as Partial<PostAuthRedirectStash>;
    if (
      typeof stash.path !== "string" ||
      !stash.path.startsWith("/app") ||
      typeof stash.created_at !== "number" ||
      Date.now() - stash.created_at > MAX_AGE_MS
    ) {
      return null;
    }

    return stash.path;
  } catch {
    return null;
  }
};

import { UnauthorizedError } from "../../shared/errors/app-error";

// Call only AFTER Supabase getUser(jwt) has authenticated this exact token.
// Refreshed JWT iat is deliberately not used as proof of reauthentication.
export function requireFreshAuthentication(jwt: string, authUserId: string, now = Date.now()) {
  try {
    const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString("utf8"));
    const fresh = Array.isArray(claims.amr) && claims.amr.some((entry: { method?: string; timestamp?: number }) =>
      ["password", "oauth"].includes(entry.method ?? "") &&
      typeof entry.timestamp === "number" && entry.timestamp * 1000 <= now + 30_000 &&
      entry.timestamp * 1000 >= now - 5 * 60_000);
    if (claims.sub === authUserId && fresh) return;
  } catch { /* fail closed */ }
  throw new UnauthorizedError("Sign in again with your password or Google, then confirm deletion within five minutes.");
}

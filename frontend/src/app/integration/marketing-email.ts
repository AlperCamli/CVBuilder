import { integrationConfig } from "./config";
import { createApiClient, type ApiClient } from "./api-client";

// One-click unsubscribe from marketing emails (/unsubscribe?t=<token>). Public: the token alone
// identifies the preference, and the server answers ok for any token so none can be probed.
export const UNSUBSCRIBE_TOKEN_RE = /^[A-Za-z0-9_-]{1,256}$/;

export function unsubscribeTokenFromSearch(search: string): string | null {
  const token = new URLSearchParams(search).get("t")?.trim();
  return token && UNSUBSCRIBE_TOKEN_RE.test(token) ? token : null;
}

export async function unsubscribeFromMarketing(
  token: string,
  client: ApiClient = createApiClient({ baseUrl: integrationConfig.apiBaseUrl, getAccessToken: async () => null }),
): Promise<void> {
  await client.post<{ ok: boolean }, { token: string }>("/marketing/unsubscribe", { token });
}

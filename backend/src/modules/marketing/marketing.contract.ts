import { z } from "zod";

// Unsubscribe tokens are 24 random bytes in hex (marketing_email_preferences.unsubscribe_token default).
export const UNSUBSCRIBE_TOKEN_RE = /^[0-9a-f]{48}$/;

// Any string is accepted, so the response never tells a well-formed unknown token from a malformed one.
export const unsubscribeSchema = z.object({
  token: z.string().trim().min(1).max(256),
});

export type UnsubscribeInput = z.infer<typeof unsubscribeSchema>;

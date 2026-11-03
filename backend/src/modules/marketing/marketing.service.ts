import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { InternalServerError } from "../../shared/errors/app-error";
import { UNSUBSCRIBE_TOKEN_RE } from "./marketing.contract";

export class MarketingService {
  constructor(private readonly db: Pick<SupabaseClient, "from">, private readonly logger: Pick<Logger, "error">) {}

  // Opts the token's account out of marketing email. Unknown tokens are a silent no-op, and an account that
  // already opted out keeps its first opted_out_at. A database failure is surfaced so the page can ask for a
  // retry instead of confirming an opt-out that did not happen; the token is never logged.
  async unsubscribe(token: string): Promise<void> {
    if (!UNSUBSCRIBE_TOKEN_RE.test(token)) return;
    const { error } = await this.db
      .from("marketing_email_preferences")
      .update({ opted_out_at: new Date().toISOString() })
      .eq("unsubscribe_token", token)
      .is("opted_out_at", null);
    if (!error) return;
    this.logger.error({ code: "MARKETING_UNSUBSCRIBE_FAILED" }, "Marketing unsubscribe was not saved");
    throw new InternalServerError("Your unsubscribe request could not be saved. Please try again.");
  }
}

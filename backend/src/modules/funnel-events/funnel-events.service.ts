import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import type { FunnelEventInput } from "./funnel-events.contract";

export class FunnelEventsService {
  constructor(private readonly db: Pick<SupabaseClient, "rpc">, private readonly logger: Pick<Logger, "error">) {}

  // Counting is best effort: a failure is logged without request data and never surfaces to the visitor.
  async record(input: FunnelEventInput): Promise<void> {
    try {
      const { error } = await this.db.rpc("bump_funnel_event", {
        p_event: input.event,
        p_detail: input.detail ?? null,
        p_locale: input.locale,
        p_device: input.device,
        p_utm_source: input.utm_source ?? null,
      });
      if (!error) return;
    } catch {
      // Logged below.
    }
    this.logger.error({ code: "FUNNEL_EVENT_NOT_COUNTED" }, "Funnel event was not counted");
  }
}

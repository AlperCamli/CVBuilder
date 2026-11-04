// One-off repair for subscription rows whose webhooks (API 2026-03-25.dahlia) left the billing period NULL: the
// period moved onto the subscription items there, and the webhook parser read only the top level. Each row is
// re-read through the SDK (pinned to 2024-06-20, which still has the top-level period) and only its NULL period
// columns are filled. Status, plan and the event columns are never written, so the history trigger records nothing.
// Run from backend after the parser fix is deployed: npx tsx scripts/resync-subscription-periods.ts [--apply]
// Without --apply it only prints what it would change.
import { StripeBillingGateway } from "../src/modules/billing/stripe-gateway";
import { createSupabaseClients } from "../src/shared/db/supabase";
import { getConfig } from "../src/shared/config/env";

interface Row {
  id: string;
  status: string;
  provider_subscription_id: string;
  current_period_start: string | null;
  current_period_end: string | null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const config = getConfig();
  if (!config.billing.stripeSecretKey) throw new Error("STRIPE_SECRET_KEY is required");
  const db = createSupabaseClients(config).serviceRoleClient;
  const gateway = new StripeBillingGateway(config.billing.stripeSecretKey);

  const { data, error } = await db.from("subscriptions")
    .select("id,status,provider_subscription_id,current_period_start,current_period_end")
    .eq("provider", "stripe")
    .not("provider_subscription_id", "is", null)
    .not("provider_subscription_id", "like", "lifetime_%")
    .or("current_period_start.is.null,current_period_end.is.null");
  if (error) throw new Error(error.message);

  const result = { apply, rows: data.length, filled: 0, unchanged: 0, missing: [] as string[], locked: [] as string[] };
  for (const row of data as Row[]) {
    // Subscriptions of another Stripe mode or account are not found with this key; they are listed, not guessed.
    const subscription = await gateway.retrieveSubscription(row.provider_subscription_id).catch(() => null);
    if (!subscription) { result.missing.push(row.id); continue; }
    const patch: Partial<Pick<Row, "current_period_start" | "current_period_end">> = {};
    if (!row.current_period_start && subscription.current_period_start) patch.current_period_start = subscription.current_period_start;
    if (!row.current_period_end && subscription.current_period_end) patch.current_period_end = subscription.current_period_end;
    if (!Object.keys(patch).length) { result.unchanged++; continue; }
    console.log(JSON.stringify({ id: row.id, status: row.status, stripe_status: subscription.status, ...patch }));
    if (apply) {
      // Only still-NULL columns: a webhook that already wrote a newer period wins.
      let update = db.from("subscriptions").update(patch).eq("id", row.id);
      for (const column of Object.keys(patch)) update = update.is(column, null);
      const { error: updateError } = await update;
      // Accounts being erased or restricted reject writes; leave them to the erasure archive.
      if (updateError?.message.includes("privacy_subject_unavailable")) { result.locked.push(row.id); continue; }
      if (updateError) throw new Error(updateError.message);
    }
    result.filled++;
  }
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });

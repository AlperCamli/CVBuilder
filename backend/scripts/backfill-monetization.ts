// One-off backfill for the monetization tables. Safe to re-run: every write is an upsert
// or only fills descriptive columns, and subscription status/plan are never changed.
// Run from backend: npx tsx scripts/backfill-monetization.ts [--dry-run]
import Stripe from "stripe";
import { buildDefaultServices } from "../src/app/build-services";
import { getConfig } from "../src/shared/config/env";
import { createLogger } from "../src/shared/logging/logger";
import { createSupabaseClients } from "../src/shared/db/supabase";
import { toSubscriptionDetails } from "../src/modules/billing/stripe-gateway";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const config = getConfig();
  if (!config.billing.stripeSecretKey) throw new Error("STRIPE_SECRET_KEY is required");
  const logger = createLogger(config);
  const db = createSupabaseClients(config).serviceRoleClient;
  const services = buildDefaultServices(config, logger);
  const stripe = new Stripe(config.billing.stripeSecretKey, { apiVersion: "2024-06-20" });

  const { data: rows, error } = await db.from("subscriptions")
    .select("id,provider_customer_id,provider_subscription_id,created_at")
    .not("provider_customer_id", "is", null);
  if (error) throw new Error(error.message);
  const customers = [...new Set(rows.map(row => row.provider_customer_id as string))];
  console.log(`${customers.length} Stripe customers, ${rows.filter(row => row.provider_subscription_id).length} subscriptions${dryRun ? " (dry run)" : ""}`);

  // 1. Descriptive subscription columns. Status, plan and periods stay as the app last synced them.
  let subscriptions = 0; let lockedSubscriptions = 0;
  for (const row of rows) {
    const id = row.provider_subscription_id as string | null;
    if (!id || id.startsWith("lifetime_")) continue;
    const subscription = await stripe.subscriptions.retrieve(id).catch(() => null);
    if (!subscription) continue;
    if (!dryRun) {
      const update = await db.from("subscriptions").update(toSubscriptionDetails(subscription)).eq("id", row.id);
      // Accounts being erased or restricted reject writes; leave them to the erasure archive.
      if (update.error?.message.includes("privacy_subject_unavailable")) { lockedSubscriptions++; continue; }
      if (update.error) throw new Error(update.error.message);
    }
    subscriptions++;
  }

  // 2. Every invoice of every known customer, through the same path as the webhook.
  let invoices = 0; let skipped = 0;
  for (const customer of customers) {
    for await (const invoice of stripe.invoices.list({ customer, limit: 100 })) {
      if (invoice.status === "draft") continue;
      if (dryRun || await services.billingService.syncInvoice(invoice.id)) invoices++; else skipped++;
    }
  }

  // 3. Catalogs, internal accounts, and monthly FX back to the first subscription.
  const refresh = services.monetizationRefreshService!;
  const first = rows.reduce((min, row) => (row.created_at < min ? row.created_at : min), new Date().toISOString());
  const months: Date[] = [];
  for (let month = new Date(first.slice(0, 7) + "-01T00:00:00Z"); month <= new Date(); month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1))) months.push(month);
  const summary = dryRun ? null : { ...(await refresh.refresh()), fx_months: await refresh.refreshFxMonths(months) };

  console.log(JSON.stringify({ subscriptions, locked_subscriptions: lockedSubscriptions, invoices, skipped_invoices: skipped, fx_from: first.slice(0, 7), refresh: summary }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });

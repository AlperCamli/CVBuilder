// Local alternative to GET /api/v1/billing/analytics/backfill (same service, no time budget).
// Safe to re-run: work already done is skipped and subscription status/plan are never changed.
// Run from backend: npx tsx scripts/backfill-monetization.ts [--dry-run]
import { buildDefaultServices } from "../src/app/build-services";
import { getConfig } from "../src/shared/config/env";
import { createLogger } from "../src/shared/logging/logger";

async function main() {
  const config = getConfig();
  if (!config.billing.stripeSecretKey) throw new Error("STRIPE_SECRET_KEY is required");
  const services = buildDefaultServices(config, createLogger(config));
  const result = await services.monetizationBackfillService!.run({ dryRun: process.argv.includes("--dry-run") });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });

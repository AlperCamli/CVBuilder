// Creates or updates one promotion from promotions/<slug>/campaign.json (docs/promotions/README.md):
// the Stripe coupon (found by metadata promotion_slug), the promotions and promotion_cohorts rows, and the
// recipients with their seeded cohort and marketing_email_preferences row. Safe to re-run: existing coupons,
// assignments and unsubscribe tokens are kept; changing a cohort's ends_at and re-running extends its window.
// Run from backend: npm run promotion:setup -- --config ../promotions/<slug>/campaign.json [--dry-run] [--live]
// Prints counts only, never emails, names or tokens.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConfig, type AppConfig } from "../../src/shared/config/env";
import { createSupabaseClients } from "../../src/shared/db/supabase";
import {
  PAYING_STATUSES,
  assignCohorts,
  assignmentOpen,
  countByCohortAndLocale,
  couponMismatches,
  couponTerms,
  isEligibleAccount,
  parseCampaign,
  promotionRow,
  stratumOf,
  type AccountFacts,
  type Campaign,
  type CouponTerms,
  type PurchasePlanCode,
} from "./campaign";

class SetupError extends Error {}

const OPTIONS = ["--dry-run", "--live", "--assign-after-start", "--allow-remote-test-db", "--help"];
const PAGE = 1000;
const BATCH = 500;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "host.docker.internal"]);

function parseArgs(argv: string[]) {
  const flags = new Set<string>();
  let config: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--config") config = argv[++index];
    else if (arg.startsWith("--config=")) config = arg.slice("--config=".length);
    else if (OPTIONS.includes(arg)) flags.add(arg);
    else throw new SetupError(`Unknown option ${arg}. Use --help.`);
  }
  return {
    config,
    help: flags.has("--help"),
    dryRun: flags.has("--dry-run"),
    live: flags.has("--live"),
    assignAfterStart: flags.has("--assign-after-start"),
    allowRemoteTestDb: flags.has("--allow-remote-test-db"),
  };
}

function printHelp() {
  console.log("Usage: npm run promotion:setup -- --config ../promotions/<slug>/campaign.json [options]");
  console.log("--dry-run               Print the plan. Nothing is written to Stripe or the database.");
  console.log("--live                  Required to use a live-mode Stripe key (sk_live_/rk_live_), even for --dry-run.");
  console.log("--assign-after-start    Also add new recipients after the first cohort has started (default: no).");
  console.log("--allow-remote-test-db  Allow a test-mode coupon to be written to a non-local Supabase project.");
}

// PostgREST answers these when a table does not exist (e.g. the promotions migration is not applied yet).
const isMissingTable = (error: { code?: string } | null) => !!error && ["42P01", "PGRST205", "PGRST200"].includes(error.code ?? "");

function check(error: { message?: string; code?: string } | null, what: string) {
  if (error) throw new SetupError(`Database ${what} failed${error.code ? ` (${error.code})` : ""}: ${error.message ?? "unknown error"}`);
}

async function readAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message?: string; code?: string } | null }>, what: string): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await build(offset, offset + PAGE - 1);
    check(error, what);
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < PAGE) return rows;
  }
}

const capitalize = (plan: PurchasePlanCode) => `${plan[0].toUpperCase()}${plan.slice(1)}` as "Weekly" | "Monthly" | "Annual";

// The plan's STRIPE_<PLAN>_PRODUCT_ID, plus the products behind its USD and TRY prices when Stripe can be read,
// so the coupon covers both currencies even if their prices live on different products.
async function productIds(config: AppConfig, stripe: Stripe | null, plans: PurchasePlanCode[]): Promise<string[]> {
  const ids: string[] = [];
  for (const plan of plans) {
    const name = `STRIPE_${plan.toUpperCase()}_PRODUCT_ID`;
    const id = config.billing[`${plan}ProductId`] ?? config.billing.productId;
    if (!id || !/^prod_[A-Za-z0-9]+$/.test(id)) throw new SetupError(`Set ${name} to this plan's prod_ ID (or STRIPE_PRODUCT_ID for a shared product).`);
    ids.push(id);
    if (!stripe) continue;
    for (const priceId of [config.billing[`stripe${capitalize(plan)}PriceId`], config.billing[`try${capitalize(plan)}PriceId`]]) {
      if (!priceId) continue;
      const price = await stripe.prices.retrieve(priceId);
      const product = typeof price.product === "string" ? price.product : price.product.id;
      if (product !== id) console.log(`Note: the ${price.currency.toUpperCase()} ${plan} price is on ${product}, not ${name}; the coupon covers both products.`);
      ids.push(product);
    }
  }
  return ids;
}

async function findCoupon(stripe: Stripe, slug: string): Promise<Stripe.Coupon | null> {
  const matches: Stripe.Coupon[] = [];
  for await (const coupon of stripe.coupons.list({ limit: 100, expand: ["data.applies_to"] })) {
    if (coupon.metadata?.promotion_slug === slug) matches.push(coupon);
  }
  if (matches.length > 1) throw new SetupError(`Stripe has ${matches.length} coupons with metadata promotion_slug=${slug} (${matches.map(c => c.id).join(", ")}). Delete the extra ones and re-run.`);
  return matches[0] ?? null;
}

async function ensureCoupon(stripe: Stripe | null, terms: CouponTerms, mode: string, dryRun: boolean): Promise<{ id: string | null; action: string }> {
  if (!stripe) return { id: null, action: "not checked (no usable Stripe key for this run)" };
  const existing = await findCoupon(stripe, terms.metadata.promotion_slug);
  if (existing) {
    const problems = couponMismatches(existing as Parameters<typeof couponMismatches>[0], terms);
    if (problems.length)
      throw new SetupError(`Stripe coupon ${existing.id} for this slug does not match campaign.json: ${problems.join("; ")}. Coupon terms cannot be changed; use a new slug, or delete the coupon in Stripe if no checkout used it.`);
    return { id: existing.id, action: "existing" };
  }
  if (dryRun) return { id: null, action: "would create" };
  const created = await stripe.coupons.create(terms, { idempotencyKey: `cv-promotion-coupon-${mode}-${createHash("sha256").update(JSON.stringify(terms)).digest("hex")}` });
  return { id: created.id, action: "created" };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }
  if (!args.config) throw new SetupError("Pass --config ../promotions/<slug>/campaign.json. Use --help.");
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(resolve(process.cwd(), args.config), "utf8")); }
  catch { throw new SetupError(`Cannot read ${args.config} as JSON.`); }
  const campaign: Campaign = parseCampaign(raw);
  const now = new Date();

  const config = getConfig();
  const key = config.billing.stripeSecretKey?.trim() ?? "";
  if (key && !/^(sk|rk)_(test|live)_/.test(key)) throw new SetupError("STRIPE_SECRET_KEY must be an sk_ or rk_ key.");
  const mode = key.includes("_live_") ? "live" : key ? "test" : "none";
  if (mode === "live" && !args.live && !args.dryRun) throw new SetupError("STRIPE_SECRET_KEY is a live-mode key. Pass --live to create the live coupon and write recipients.");
  if (mode === "none" && !args.dryRun) throw new SetupError("Set STRIPE_SECRET_KEY in backend/.env.local or the process environment.");
  const dbHost = new URL(config.supabase.url).hostname;
  const remoteDb = !LOCAL_HOSTS.has(dbHost);
  if (mode === "test" && remoteDb && !args.dryRun && !args.allowRemoteTestDb)
    throw new SetupError(`A test-mode coupon would be written to the remote Supabase project ${dbHost}; live checkouts there could not use it. Pass --allow-remote-test-db if that project is a staging copy.`);
  const stripe = mode === "test" || (mode === "live" && args.live) ? new Stripe(key, { apiVersion: "2024-06-20", timeout: 20_000, maxNetworkRetries: 1 }) : null;

  console.log(`Campaign ${campaign.slug} | Stripe mode: ${mode}${mode === "live" && !args.live ? " (not used without --live)" : ""} | database: ${dbHost} | ${args.dryRun ? "DRY RUN, nothing is written" : "writing"}`);

  // 1. Stripe coupon.
  const terms = couponTerms(campaign, await productIds(config, stripe, campaign.plan_codes));
  const coupon = await ensureCoupon(stripe, terms, mode, args.dryRun);
  console.log(`Coupon: ${coupon.action}${coupon.id ? ` ${coupon.id}` : ""} | ${terms.percent_off}% off, ${terms.duration}${terms.duration_in_months ? ` ${terms.duration_in_months} months` : ""}, products ${terms.applies_to.products.join(",")}, name "${terms.name}"`);

  const db: SupabaseClient = createSupabaseClients(config).serviceRoleClient;

  // 2. Promotion and cohorts.
  const found = await db.from("promotions").select("id,stripe_coupon_id,archived_at").eq("slug", campaign.slug).maybeSingle();
  const tablesMissing = isMissingTable(found.error);
  if (tablesMissing && !args.dryRun) throw new SetupError("The promotions tables do not exist. Apply backend/supabase/migrations/20261110120000_promotions.sql first.");
  if (!tablesMissing) check(found.error, "read of promotions");
  if (tablesMissing) console.log("Promotion tables are not in this database yet (migration 20261110120000_promotions.sql not applied); planning as if empty.");
  const existingPromotion = (found.data as { id: string; stripe_coupon_id: string; archived_at: string | null } | null) ?? null;
  if (existingPromotion && coupon.id && existingPromotion.stripe_coupon_id !== coupon.id)
    console.log(`Note: the promotion row points at coupon ${existingPromotion.stripe_coupon_id}; it will be updated to ${coupon.id}.`);
  const existingCohorts = existingPromotion
    ? await readAll<{ id: string; key: string; starts_at: string; ends_at: string; label: string | null }>(
        (from, to) => db.from("promotion_cohorts").select("id,key,starts_at,ends_at,label").eq("promotion_id", existingPromotion.id).order("key").range(from, to), "read of promotion_cohorts")
    : [];
  console.log(`Promotion: ${existingPromotion ? "update" : args.dryRun ? "would create" : "create"}${campaign.archived_at !== undefined ? ` (archived_at -> ${campaign.archived_at ?? "null"})` : existingPromotion?.archived_at ? " (archived)" : ""}`);
  for (const cohort of campaign.cohorts) {
    const current = existingCohorts.find(row => row.key === cohort.key);
    const changed = !current
      ? "new"
      : Date.parse(current.starts_at) !== Date.parse(cohort.starts_at) || Date.parse(current.ends_at) !== Date.parse(cohort.ends_at) || (current.label ?? null) !== (cohort.label ?? null)
        ? `changed (was ${new Date(current.starts_at).toISOString()} -> ${new Date(current.ends_at).toISOString()})`
        : "unchanged";
    console.log(`Cohort ${cohort.key}: ${cohort.starts_at} -> ${cohort.ends_at} | ${changed}`);
  }
  for (const row of existingCohorts) if (!campaign.cohorts.some(cohort => cohort.key === row.key))
    console.log(`Warning: cohort ${row.key} exists in the database but not in campaign.json; it is left unchanged.`);

  let promotionId = existingPromotion?.id ?? null;
  let cohortIds = new Map(existingCohorts.map(row => [row.key, row.id]));
  if (!args.dryRun) {
    const upserted = await db.from("promotions").upsert(promotionRow(campaign, coupon.id!), { onConflict: "slug" }).select("id").single();
    check(upserted.error, "upsert of promotions");
    promotionId = (upserted.data as { id: string }).id;
    const cohorts = await db.from("promotion_cohorts")
      .upsert(campaign.cohorts.map(cohort => ({ promotion_id: promotionId, key: cohort.key, label: cohort.label ?? null, starts_at: cohort.starts_at, ends_at: cohort.ends_at })), { onConflict: "promotion_id,key" })
      .select("id,key");
    check(cohorts.error, "upsert of promotion_cohorts");
    cohortIds = new Map((cohorts.data as Array<{ id: string; key: string }>).map(row => [row.key, row.id]));
  }

  // 3. Audience and assignment. Only ids and eligibility facts are read, never emails or names.
  const accounts = await readAll<AccountFacts>(
    (from, to) => db.from("users").select("id,locale,is_internal,deletion_requested_at,processing_restricted_at").order("id").range(from, to), "read of users");
  const paying = new Set((await readAll<{ user_id: string }>(
    (from, to) => db.from("subscriptions").select("user_id").neq("plan_code", "free").in("status", [...PAYING_STATUSES]).order("id").range(from, to), "read of subscriptions"))
    .map(row => row.user_id));
  const preferences = tablesMissing ? [] : await readAll<{ user_id: string; opted_out_at: string | null }>(
    (from, to) => db.from("marketing_email_preferences").select("user_id,opted_out_at").order("user_id").range(from, to), "read of marketing_email_preferences");
  const optedOut = new Set(preferences.filter(row => row.opted_out_at).map(row => row.user_id));
  const hasPreferences = new Set(preferences.map(row => row.user_id));
  const existingRecipients = promotionId && !tablesMissing ? await readAll<{ user_id: string; cohort_id: string }>(
    (from, to) => db.from("promotion_recipients").select("user_id,cohort_id").eq("promotion_id", promotionId!).order("user_id").range(from, to), "read of promotion_recipients") : [];

  const accountById = new Map(accounts.map(account => [account.id, account]));
  const keyByCohortId = new Map([...cohortIds].map(([cohortKey, id]) => [id, cohortKey]));
  const existing = existingRecipients.flatMap(row => {
    const account = accountById.get(row.user_id);
    const cohortKey = keyByCohortId.get(row.cohort_id);
    return account && cohortKey ? [{ userId: row.user_id, stratum: stratumOf(campaign, account), cohortKey, locale: account.locale }] : [];
  });
  const eligible = accounts.filter(account => isEligibleAccount(account, paying, optedOut));
  const open = assignmentOpen(campaign, now) || args.assignAfterStart;
  const assigned = existingRecipients.length ? new Set(existingRecipients.map(row => row.user_id)) : new Set<string>();
  const unassigned = eligible.filter(account => !assigned.has(account.id));
  const placements = open
    ? assignCohorts({
        seed: campaign.assignment.seed,
        cohortKeys: campaign.cohorts.map(cohort => cohort.key),
        candidates: unassigned.map(account => ({ userId: account.id, stratum: stratumOf(campaign, account) })),
        existing,
      })
    : new Map<string, string>();
  if (!open && unassigned.length)
    console.log(`Assignment is closed (the first cohort started); ${unassigned.length} eligible accounts without a cohort are not added. Pass --assign-after-start to add them.`);

  const recipientUserIds = [...existingRecipients.map(row => row.user_id), ...placements.keys()];
  const missingPreferences = recipientUserIds.filter(userId => !hasPreferences.has(userId));

  if (!args.dryRun) {
    const rows = [...placements].map(([userId, cohortKey]) => ({ promotion_id: promotionId, user_id: userId, cohort_id: cohortIds.get(cohortKey)! }));
    for (let index = 0; index < rows.length; index += BATCH) {
      const { error } = await db.from("promotion_recipients").upsert(rows.slice(index, index + BATCH), { onConflict: "promotion_id,user_id", ignoreDuplicates: true });
      check(error, "insert of promotion_recipients");
    }
    for (let index = 0; index < missingPreferences.length; index += BATCH) {
      const { error } = await db.from("marketing_email_preferences")
        .upsert(missingPreferences.slice(index, index + BATCH).map(userId => ({ user_id: userId })), { onConflict: "user_id", ignoreDuplicates: true });
      check(error, "insert of marketing_email_preferences");
    }
  }

  // 4. Summary: counts only.
  const before = countByCohortAndLocale(existing);
  const added = countByCohortAndLocale([...placements].map(([userId, cohortKey]) => ({ cohortKey, locale: accountById.get(userId)!.locale })));
  console.log(`Accounts: ${accounts.length} total, ${eligible.length} eligible now (non-paying, not internal, not deleting/restricted, not opted out).`);
  for (const cohort of campaign.cohorts) {
    const locales = [...new Set([...Object.keys(before[cohort.key] ?? {}), ...Object.keys(added[cohort.key] ?? {})])].sort();
    const parts = locales.map(locale => `${locale} ${(before[cohort.key]?.[locale] ?? 0) + (added[cohort.key]?.[locale] ?? 0)} (+${added[cohort.key]?.[locale] ?? 0})`);
    console.log(`Recipients cohort ${cohort.key}: ${parts.join(", ") || "none"}`);
  }
  console.log(`Recipients: ${recipientUserIds.length} (${placements.size} ${args.dryRun ? "would be added" : "added"} this run); marketing preference rows ${args.dryRun ? "to create" : "created"}: ${missingPreferences.length}.`);
  if (!args.dryRun) {
    const queue = await readAll<{ cohort_key: string; locale: string }>(
      (from, to) => db.from("promotion_email_queue").select("cohort_key,locale").eq("promotion_slug", campaign.slug).order("sort_order").range(from, to), "read of promotion_email_queue");
    const counts = countByCohortAndLocale(queue.map(row => ({ cohortKey: row.cohort_key, locale: row.locale })));
    console.log(`Email queue now: ${Object.entries(counts).map(([cohortKey, byLocale]) => `${cohortKey} ${Object.entries(byLocale).map(([locale, count]) => `${locale} ${count}`).join("/")}`).join(", ") || "empty"}.`);
  }
}

void main().catch(error => {
  // Stripe authentication errors can contain portions of credentials; omit their messages.
  if (error instanceof SetupError) console.error(error.message);
  else if (error instanceof Stripe.errors.StripeError)
    console.error(`Stripe request failed (${error.type}${error.code ? `, ${error.code}` : ""}). Check API-key permissions, product IDs and test/live mode.`);
  else console.error(String(error instanceof Error ? error.message : error).replace(/\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]+\b/g, "[redacted]"));
  process.exitCode = 1;
});

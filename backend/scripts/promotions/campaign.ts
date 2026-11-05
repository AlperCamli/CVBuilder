// Pure parts of the promotion setup script (setup-campaign.ts): campaign.json validation, the Stripe coupon
// terms, account eligibility and the seeded cohort assignment. Tested by tests/promotion-setup.unit.test.ts.
import { createHash } from "node:crypto";
import { z } from "zod";

export const PURCHASE_PLANS = ["weekly", "monthly", "annual"] as const;
export type PurchasePlanCode = (typeof PURCHASE_PLANS)[number];
// Subscriptions that count as paying (same list as public.promotion_email_queue).
export const PAYING_STATUSES = ["active", "trialing", "past_due"] as const;
// Stripe rejects coupon names longer than this.
const STRIPE_COUPON_NAME_MAX = 40;

const isoDate = z.string().datetime({ offset: true }).transform(value => new Date(value).toISOString());
// UTM values and cohort keys go into links unencoded, so they are limited to URL-safe characters.
const urlSafe = z.string().regex(/^[A-Za-z0-9._~-]{1,64}$/);

export const campaignSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    name: z.string().trim().min(1).max(200),
    // Optional customer-facing coupon name; defaults to name when short enough, else a generic description.
    coupon_name: z.string().trim().min(1).max(STRIPE_COUPON_NAME_MAX).optional(),
    percent_off: z.number().int().min(1).max(100),
    plan_codes: z.array(z.enum(PURCHASE_PLANS)).min(1).refine(codes => new Set(codes).size === codes.length, "plan_codes must be unique"),
    duration: z.enum(["once", "repeating", "forever"]),
    duration_in_months: z.number().int().min(1).max(36).nullable().optional(),
    replaces_trial: z.boolean().default(true),
    audience: z.literal("non_paying"),
    site_url: z.string().url().regex(/^https?:\/\/[^/?#]+\/?$/, "site_url must be an origin without a path").transform(url => url.replace(/\/$/, "")),
    utm: z.object({ source: urlSafe, medium: urlSafe, campaign: urlSafe }).partial().strict().default({}),
    cohorts: z
      .array(
        z.object({
          key: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
          label: z.string().trim().min(1).max(100).nullable().optional(),
          starts_at: isoDate,
          ends_at: isoDate,
        })
      )
      .min(1),
    assignment: z.object({
      strategy: z.literal("random_stratified"),
      stratify_by: z.array(z.literal("locale")).default([]),
      seed: z.string().min(1).max(200),
    }),
    // Present (an ISO time) to archive the promotion, null to unarchive it; absent leaves the database value.
    archived_at: isoDate.nullable().optional(),
  })
  .superRefine((campaign, context) => {
    if ((campaign.duration === "repeating") !== (campaign.duration_in_months != null))
      context.addIssue({ code: "custom", path: ["duration_in_months"], message: "duration_in_months is required for (and only for) duration \"repeating\"" });
    const keys = campaign.cohorts.map(cohort => cohort.key);
    if (new Set(keys).size !== keys.length) context.addIssue({ code: "custom", path: ["cohorts"], message: "cohort keys must be unique" });
    campaign.cohorts.forEach((cohort, index) => {
      if (Date.parse(cohort.ends_at) <= Date.parse(cohort.starts_at))
        context.addIssue({ code: "custom", path: ["cohorts", index, "ends_at"], message: "ends_at must be after starts_at" });
    });
  });

export type Campaign = z.infer<typeof campaignSchema>;

// A promotion shown on the cancel screen (docs/promotions/cancel-flow-offer.md) to one audience: a trial, or a paid
// weekly, monthly or annual plan. No cohorts or links. Its one plan is what the offer moves to: any plan for a trial
// (paid now by checkout; it fits a Monthly trial and a Weekly trial started before 2026-11-05 alike), another plan for
// paid weekly (from the end of the paid week), and the same plan for monthly and annual (the next renewal is discounted).
export const cancelFlowCampaignSchema = z
  .object({
    channel: z.literal("cancel_flow"),
    audience: z.enum(["trial", ...PURCHASE_PLANS]),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    name: z.string().trim().min(1).max(200),
    coupon_name: z.string().trim().min(1).max(STRIPE_COUPON_NAME_MAX).optional(),
    percent_off: z.number().int().min(1).max(100),
    plan_codes: z.tuple([z.enum(PURCHASE_PLANS)]),
    duration: z.enum(["once", "repeating", "forever"]),
    duration_in_months: z.number().int().min(1).max(36).nullable().optional(),
    site_url: z.string().url().regex(/^https?:\/\/[^/?#]+\/?$/, "site_url must be an origin without a path").transform(url => url.replace(/\/$/, "")),
    archived_at: isoDate.nullable().optional(),
  })
  .strict()
  .superRefine((campaign, context) => {
    if ((campaign.duration === "repeating") !== (campaign.duration_in_months != null))
      context.addIssue({ code: "custom", path: ["duration_in_months"], message: "duration_in_months is required for (and only for) duration \"repeating\"" });
    const [plan] = campaign.plan_codes;
    if (campaign.audience === "weekly" && plan === "weekly")
      context.addIssue({ code: "custom", path: ["plan_codes"], message: "a paid-weekly offer moves to another plan" });
    if ((campaign.audience === "monthly" || campaign.audience === "annual") && plan !== campaign.audience)
      context.addIssue({ code: "custom", path: ["plan_codes"], message: "a monthly or annual offer discounts the same plan's renewal" });
  });

export type CancelFlowCampaign = z.infer<typeof cancelFlowCampaignSchema>;

const invalid = (error: z.ZodError) =>
  new Error(`Invalid campaign config: ${error.issues.map(issue => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`);

export const isCancelFlowConfig = (raw: unknown): boolean =>
  typeof raw === "object" && raw !== null && (raw as { channel?: unknown }).channel === "cancel_flow";

export function parseCampaign(raw: unknown): Campaign {
  if (isCancelFlowConfig(raw)) throw new Error("Invalid campaign config: channel: a cancel_flow campaign has no audience or cohorts; it is set up by the cancel-flow path.");
  const parsed = campaignSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw invalid(parsed.error);
}

export function parseCancelFlowCampaign(raw: unknown): CancelFlowCampaign {
  const parsed = cancelFlowCampaignSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  throw invalid(parsed.error);
}

export function cancelFlowPromotionRow(campaign: CancelFlowCampaign, stripeCouponId: string) {
  return {
    slug: campaign.slug,
    name: campaign.name,
    channel: "cancel_flow" as const,
    cancel_audience: campaign.audience,
    percent_off: campaign.percent_off,
    plan_codes: [...campaign.plan_codes],
    duration: campaign.duration,
    duration_in_months: campaign.duration_in_months ?? null,
    replaces_trial: false,
    stripe_coupon_id: stripeCouponId,
    site_url: campaign.site_url,
    utm: {},
    ...(campaign.archived_at !== undefined ? { archived_at: campaign.archived_at } : {}),
  };
}

// The promotions row written for a campaign. archived_at is only included when the config sets it.
export function promotionRow(campaign: Campaign, stripeCouponId: string) {
  return {
    slug: campaign.slug,
    name: campaign.name,
    percent_off: campaign.percent_off,
    plan_codes: campaign.plan_codes,
    duration: campaign.duration,
    duration_in_months: campaign.duration_in_months ?? null,
    replaces_trial: campaign.replaces_trial,
    stripe_coupon_id: stripeCouponId,
    site_url: campaign.site_url,
    utm: campaign.utm,
    ...(campaign.archived_at !== undefined ? { archived_at: campaign.archived_at } : {}),
  };
}

// New recipients are only added until the first cohort starts, unless the operator asks otherwise.
export const assignmentOpen = (campaign: Campaign, now: Date): boolean =>
  now.getTime() < Math.min(...campaign.cohorts.map(cohort => Date.parse(cohort.starts_at)));

// The campaign fields the Stripe coupon is built from (email and cancel-flow campaigns).
type CouponCampaign = Pick<Campaign, "slug" | "name" | "coupon_name" | "percent_off" | "duration" | "duration_in_months">;

// Stripe coupons are currency-agnostic: one coupon covers USD and TRY checkouts of the listed products.
export function couponName(campaign: CouponCampaign): string {
  if (campaign.coupon_name) return campaign.coupon_name;
  if (campaign.name.length <= STRIPE_COUPON_NAME_MAX) return campaign.name;
  if (campaign.duration === "once") return `${campaign.percent_off}% off first payment`;
  if (campaign.duration === "repeating") return `${campaign.percent_off}% off for ${campaign.duration_in_months} months`;
  return `${campaign.percent_off}% off`;
}

export interface CouponTerms {
  percent_off: number;
  duration: Campaign["duration"];
  duration_in_months?: number;
  applies_to: { products: string[] };
  name: string;
  metadata: { promotion_slug: string };
}

export function couponTerms(campaign: CouponCampaign, productIds: string[]): CouponTerms {
  return {
    percent_off: campaign.percent_off,
    duration: campaign.duration,
    ...(campaign.duration === "repeating" ? { duration_in_months: campaign.duration_in_months! } : {}),
    applies_to: { products: [...new Set(productIds)].sort() },
    name: couponName(campaign),
    metadata: { promotion_slug: campaign.slug },
  };
}

export interface ExistingCoupon {
  id: string;
  percent_off: number | null;
  duration: string;
  duration_in_months: number | null;
  valid: boolean;
  applies_to?: { products: string[] } | null;
}

// Coupon terms are immutable at Stripe, so a mismatch is reported instead of being "fixed". The name may differ.
export function couponMismatches(coupon: ExistingCoupon, terms: CouponTerms): string[] {
  const problems: string[] = [];
  if (coupon.percent_off !== terms.percent_off) problems.push(`percent_off is ${coupon.percent_off}`);
  if (coupon.duration !== terms.duration) problems.push(`duration is ${coupon.duration}`);
  if ((coupon.duration_in_months ?? null) !== (terms.duration_in_months ?? null)) problems.push(`duration_in_months is ${coupon.duration_in_months}`);
  const products = [...(coupon.applies_to?.products ?? [])].sort();
  if (products.join(",") !== terms.applies_to.products.join(","))
    problems.push(products.length ? `applies_to.products is ${products.join(",")}` : "it applies to every product");
  if (!coupon.valid) problems.push("it is no longer valid");
  return problems;
}

export interface AccountFacts {
  id: string;
  locale: string;
  is_internal: boolean;
  deletion_requested_at: string | null;
  processing_restricted_at: string | null;
}

// Non-paying audience, mirroring public.promotion_email_queue: never subscribed or lapsed, not internal, not pending
// deletion or restricted, not opted out of marketing email.
export const isEligibleAccount = (account: AccountFacts, payingUserIds: ReadonlySet<string>, optedOutUserIds: ReadonlySet<string>): boolean =>
  !account.is_internal &&
  account.deletion_requested_at === null &&
  account.processing_restricted_at === null &&
  !payingUserIds.has(account.id) &&
  !optedOutUserIds.has(account.id);

export const stratumOf = (campaign: Campaign, account: Pick<AccountFacts, "locale">): string =>
  campaign.assignment.stratify_by.map(field => `${field}=${account[field]}`).join("|") || "all";

const seededRank = (...parts: string[]): string => createHash("sha256").update(parts.join(":")).digest("hex");

export interface AssignmentInput {
  seed: string;
  cohortKeys: string[];
  // Accounts to place, with their stratum (stratumOf).
  candidates: Array<{ userId: string; stratum: string }>;
  // Accounts that already have a cohort keep it and count towards the balance of their stratum.
  existing: Array<{ userId: string; stratum: string; cohortKey: string }>;
}

// Deterministic seeded random assignment, balanced within each stratum: candidates are shuffled by a seeded hash
// of their id, then each one joins the cohort of its stratum with the fewest members (ties broken by a seeded
// cohort order per stratum, so odd remainders do not always favour the first cohort). The same inputs always
// give the same result, and re-runs only place accounts that have no cohort yet.
export function assignCohorts(input: AssignmentInput): Map<string, string> {
  if (!input.cohortKeys.length) throw new Error("At least one cohort is required");
  const assigned = new Set(input.existing.map(row => row.userId));
  const byStratum = new Map<string, string[]>();
  for (const candidate of input.candidates) {
    if (assigned.has(candidate.userId)) continue;
    assigned.add(candidate.userId);
    if (!byStratum.has(candidate.stratum)) byStratum.set(candidate.stratum, []);
    byStratum.get(candidate.stratum)!.push(candidate.userId);
  }
  const result = new Map<string, string>();
  for (const stratum of [...byStratum.keys()].sort()) {
    const counts = new Map(input.cohortKeys.map(key => [key, 0]));
    for (const row of input.existing) if (row.stratum === stratum && counts.has(row.cohortKey)) counts.set(row.cohortKey, counts.get(row.cohortKey)! + 1);
    const tieOrder = [...input.cohortKeys].sort((a, b) => seededRank(input.seed, stratum, a).localeCompare(seededRank(input.seed, stratum, b)) || a.localeCompare(b));
    const users = byStratum.get(stratum)!
      .map(userId => ({ userId, rank: seededRank(input.seed, userId) }))
      .sort((a, b) => a.rank.localeCompare(b.rank) || a.userId.localeCompare(b.userId));
    for (const { userId } of users) {
      const cohortKey = tieOrder.reduce((best, key) => (counts.get(key)! < counts.get(best)! ? key : best));
      counts.set(cohortKey, counts.get(cohortKey)! + 1);
      result.set(userId, cohortKey);
    }
  }
  return result;
}

// Counts per cohort and locale for the summary; never includes identifiers.
export function countByCohortAndLocale(rows: Array<{ cohortKey: string; locale: string }>): Record<string, Record<string, number>> {
  const counts: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    counts[row.cohortKey] ??= {};
    counts[row.cohortKey][row.locale] = (counts[row.cohortKey][row.locale] ?? 0) + 1;
  }
  return counts;
}

import type { StripeGateway } from "../billing/stripe-gateway";
import type { BillingMarket, PurchasePlan } from "../billing/regional-pricing";
import type { EntitlementsService } from "../entitlements/entitlements.service";
import type { FxRateRow, MonetizationRepository, PriceCatalogRow } from "./monetization.repository";

// Copies pricing and plan rules that live in env/code into the database once a day,
// together with the monthly USD->TRY average used to report revenue in one currency.

export interface MonetizationRefreshOptions {
  prices: Record<BillingMarket, Record<PurchasePlan, string | null>>;
  legacyPrices: { pro: string | null; lifetime: string | null };
  historicalPrices: Record<string, PurchasePlan>;
  trialDays: number;
  adminEmails: string[];
  fetchImpl?: typeof fetch;
}

export interface MonetizationRefreshResult {
  prices: number;
  plans: number;
  fx_months: string[];
  internal_accounts: number;
  failures: string[];
}

const FX_SOURCE = "ecb_frankfurter";
const MARKET_BY_CURRENCY: Record<string, BillingMarket> = { usd: "GLOBAL", try: "TR" };

const monthStart = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

export class MonetizationRefreshService {
  constructor(
    private readonly repository: MonetizationRepository,
    private readonly gateway: StripeGateway | null,
    private readonly entitlementsService: EntitlementsService,
    private readonly options: MonetizationRefreshOptions
  ) {}

  // Each step runs even if another fails; failures are reported, not thrown.
  async refresh(now = new Date()): Promise<MonetizationRefreshResult> {
    const result: MonetizationRefreshResult = { prices: 0, plans: 0, fx_months: [], internal_accounts: 0, failures: [] };
    const step = async (name: string, run: () => Promise<void>) => {
      try { await run(); } catch (error) { result.failures.push(`${name}: ${error instanceof Error ? error.message : "unknown"}`); }
    };
    await step("prices", async () => { result.prices = await this.refreshPriceCatalog(); });
    await step("plans", async () => { result.plans = await this.refreshPlanCatalog(); });
    // The previous month is refreshed too so it is finalised once the month has closed.
    const current = monthStart(now);
    const previous = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1));
    await step("fx", async () => { result.fx_months = await this.refreshFxMonths([previous, current], now); });
    await step("internal_accounts", async () => {
      result.internal_accounts = await this.repository.markInternalUsers(this.options.adminEmails);
    });
    return result;
  }

  async refreshPriceCatalog(): Promise<number> {
    if (!this.gateway?.retrievePrice) return 0;
    const configured = new Map<string, { plan_code: string; market: BillingMarket | null; is_configured: boolean }>();
    for (const [market, prices] of Object.entries(this.options.prices) as Array<[BillingMarket, Record<PurchasePlan, string | null>]>) {
      for (const [plan, id] of Object.entries(prices)) if (id) configured.set(id, { plan_code: plan, market, is_configured: true });
    }
    for (const [plan, id] of Object.entries(this.options.legacyPrices)) {
      if (id && !configured.has(id)) configured.set(id, { plan_code: plan, market: null, is_configured: true });
    }
    for (const [id, plan] of Object.entries(this.options.historicalPrices)) {
      if (!configured.has(id)) configured.set(id, { plan_code: plan, market: null, is_configured: false });
    }

    const rows: PriceCatalogRow[] = [];
    for (const [id, entry] of configured) {
      const price = await this.gateway.retrievePrice(id);
      rows.push({
        provider_price_id: id,
        plan_code: entry.plan_code,
        market: entry.market ?? (price ? MARKET_BY_CURRENCY[price.currency] ?? null : null),
        currency: price?.currency ?? null,
        unit_amount: price?.amount ?? null,
        billing_interval: price ? price.interval ?? "one_time" : null,
        interval_count: price?.interval_count ?? null,
        product_id: price?.product_id ?? null,
        stripe_active: price?.active ?? null,
        is_configured: entry.is_configured
      });
    }
    await this.repository.upsertPriceCatalog(rows);
    return rows.length;
  }

  async refreshPlanCatalog(): Promise<number> {
    const plans = Object.values(this.entitlementsService.getPlanCatalog());
    await this.repository.upsertPlanCatalog(plans.map(plan => ({
      plan_code: plan.code,
      name: plan.name,
      limits: { ...plan.limits },
      features: { ...plan.features },
      checkout_allowed: plan.checkout_allowed,
      trial_supported: plan.trial_supported,
      trial_days: plan.trial_supported ? this.options.trialDays : 0,
      legacy: Boolean(plan.legacy)
    })));
    return plans.length;
  }

  // Monthly average of ECB daily reference rates; the running month is month-to-date.
  async refreshFxMonths(months: Date[], now = new Date()): Promise<string[]> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const rows: FxRateRow[] = [];
    for (const month of months.map(monthStart)) {
      const lastDay = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0));
      const end = lastDay < now ? lastDay : now;
      if (end < month) continue;
      const response = await fetchImpl(`https://api.frankfurter.dev/v1/${isoDay(month)}..${isoDay(end)}?base=USD&symbols=TRY`, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`FX source returned ${response.status}`);
      const body = await response.json() as { rates?: Record<string, { TRY?: number }> };
      const daily = Object.entries(body.rates ?? {})
        .filter(([day]) => day >= isoDay(month) && day <= isoDay(end))
        .map(([, rate]) => rate.TRY)
        .filter((rate): rate is number => typeof rate === "number" && rate > 0);
      if (!daily.length) continue;
      rows.push({
        rate_month: isoDay(month),
        base_currency: "USD",
        quote_currency: "TRY",
        rate: Number((daily.reduce((sum, rate) => sum + rate, 0) / daily.length).toFixed(8)),
        sample_days: daily.length,
        source: FX_SOURCE,
        is_final: isoDay(lastDay) < isoDay(now)
      });
    }
    await this.repository.upsertFxRates(rows);
    return rows.map(row => row.rate_month);
  }
}

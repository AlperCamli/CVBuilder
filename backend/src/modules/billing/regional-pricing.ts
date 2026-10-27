import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BillingConfigurationError,
  ConflictError,
  InternalServerError,
} from "../../shared/errors/app-error";
import type { StripeGateway } from "./stripe-gateway";

export const BILLING_MARKETS = {
  GLOBAL: { currency: "usd", countries: [] as readonly string[] },
  TR: { currency: "try", countries: ["TR"] as readonly string[] },
} as const;
export type BillingMarket = keyof typeof BILLING_MARKETS;
type BillingCurrency = (typeof BILLING_MARKETS)[BillingMarket]["currency"];
export function marketForCountry(country: string | null): BillingMarket {
  return (Object.keys(BILLING_MARKETS) as BillingMarket[]).find(market => country !== null && BILLING_MARKETS[market].countries.includes(country)) ?? "GLOBAL";
}
export type PurchasePlan = "weekly" | "monthly" | "annual";
export interface RegionalPricingOptions {
  secret: string | null;
  productId?: string | null;
  productIds?: Record<PurchasePlan, string | null>;
  prices: Record<BillingMarket, Record<PurchasePlan, string | null>>;
  portals: Record<BillingMarket, string | null>;
  historicalPrices?: Record<string, PurchasePlan>;
  trialDays: number;
}
export interface BillingPrices {
  market: BillingMarket;
  currency: BillingCurrency;
  available: boolean;
  quote: string | null;
  plans: Array<{
    code: PurchasePlan;
    amount: number;
    interval: "week" | "month" | "year";
    interval_count: number;
    trial_days: number;
  }>;
}

export class RegionalPricingService {
  constructor(
    private readonly db: SupabaseClient,
    private readonly gateway: StripeGateway | null,
    readonly options: RegionalPricingOptions,
  ) {}

  async savedMarket(userId: string): Promise<BillingMarket | null> {
    const { data, error } = await this.db
      .from("billing_markets")
      .select("market")
      .eq("user_id", userId)
      .maybeSingle();
    if (error)
      throw new InternalServerError("Could not resolve billing market");
    return data?.market ?? null;
  }

  private expectedProduct(plan: PurchasePlan): string | null {
    return this.options.productIds?.[plan] ?? this.options.productId ?? null;
  }

  async getPrices(
    country: string | null,
    userId?: string,
  ): Promise<BillingPrices> {
    const market =
      (userId ? await this.savedMarket(userId) : null) ??
      marketForCountry(country);
    const currency = BILLING_MARKETS[market].currency;
    const unavailable: BillingPrices = {
      market,
      currency,
      available: false,
      quote: null,
      plans: [],
    };
    if (
      !this.gateway?.retrievePrice ||
      !this.options.secret ||
      !this.options.portals[market]
    )
      return unavailable;
    const entries = Object.entries(this.options.prices[market]) as Array<
      [PurchasePlan, string | null]
    >;
    if (entries.some(([code, id]) => !id || !this.expectedProduct(code))) return unavailable;
    const intervals = {
      weekly: "week",
      monthly: "month",
      annual: "year",
    } as const;
    const plans: BillingPrices["plans"] = [];
    try {
      if (!this.gateway.retrievePortalConfiguration) return unavailable;
      const [portal, priceRows] = await Promise.all([
        this.gateway.retrievePortalConfiguration(this.options.portals[market]!),
        Promise.all(entries.map(([, id]) => this.gateway!.retrievePrice!(id!))),
      ]);
      const marketIds = new Set(entries.map(([, id]) => id));
      if (
        !portal.active ||
        (portal.updates_enabled &&
          (portal.price_ids.some((id) => !marketIds.has(id)) ||
            entries.some(([, id]) => !portal.price_ids.includes(id!))))
      )
        return unavailable;
      for (let index = 0; index < entries.length; index++) {
        const [code] = entries[index];
        const price = priceRows[index];
        if (
          !price ||
          !price.active ||
          price.product_id !== this.expectedProduct(code) ||
          price.currency !== currency ||
          price.interval !== intervals[code] ||
          price.interval_count !== 1 ||
          !Number.isInteger(price.amount) ||
          price.amount <= 0
        )
          return unavailable;
        plans.push({
          code,
          amount: price.amount,
          interval: intervals[code],
          interval_count: 1,
          trial_days: code === "weekly" ? this.options.trialDays : 0,
        });
      }
    } catch {
      return unavailable;
    }
    const quote = this.sign({
      market,
      currency,
      plans,
      subject: userId ?? null,
      expires: Date.now() + 15 * 60_000,
    });
    return { market, currency, available: true, plans, quote };
  }

  async resolveCheckout(
    userId: string,
    country: string | null,
    quote: string | undefined,
    plan: PurchasePlan,
  ) {
    const current = await this.getPrices(country, userId);
    const supplied = this.verify(quote);
    if (!current.available || !current.quote)
      throw new BillingConfigurationError(
        "Paid checkout is currently unavailable in your billing market",
      );
    if (
      !supplied ||
      supplied.subject !== userId ||
      supplied.market !== current.market ||
      supplied.currency !== current.currency ||
      JSON.stringify(supplied.plans) !== JSON.stringify(current.plans)
    )
      throw new ConflictError(
        "Pricing changed. Review the current prices before continuing.",
        { reason: "pricing_changed" },
      );
    const { data, error } = await this.db.rpc("lock_billing_market", {
      p_user_id: userId,
      p_market: current.market,
      p_country: country,
    });
    if (error) throw new InternalServerError("Could not save billing market");
    if (data !== current.market)
      throw new ConflictError(
        "Pricing changed. Review the current prices before continuing.",
        { reason: "pricing_changed" },
      );
    return {
      priceId: this.options.prices[current.market][plan]!,
      market: current.market,
      currency: current.currency,
      amount: current.plans.find((p) => p.code === plan)!.amount,
    };
  }

  async reserveCheckout(
    userId: string,
    key: string,
  ): Promise<{ nonce: string; expires_at: string }> {
    const { data, error } = await this.db.rpc("reserve_billing_checkout", {
      p_user_id: userId,
      p_key: key,
    });
    if (error)
      throw new ConflictError(
        "Finish or cancel your existing checkout before starting another.",
        { reason: "checkout_pending" },
      );
    return data;
  }
  async rememberCheckout(
    userId: string,
    nonce: string,
    sessionId: string,
  ): Promise<void> {
    const { error } = await this.db
      .from("billing_markets")
      .update({ checkout_session_id: sessionId })
      .eq("user_id", userId)
      .eq("checkout_nonce", nonce);
    if (error) throw new InternalServerError("Could not save checkout session");
  }
  // Returns the expired session id, or null when nothing was pending.
  async cancelCheckout(userId: string): Promise<string | null> {
    const { data, error } = await this.db
      .from("billing_markets")
      .select("checkout_nonce,checkout_session_id,checkout_expires_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error)
      throw new InternalServerError("Could not resolve checkout session");
    if (
      !data?.checkout_nonce ||
      !data.checkout_session_id ||
      Date.parse(data.checkout_expires_at) < Date.now()
    )
      return null;
    if (!this.gateway?.expireCheckoutSession)
      throw new BillingConfigurationError(
        "Checkout cancellation is unavailable",
      );
    try {
      await this.gateway.expireCheckoutSession(data.checkout_session_id);
    } catch {
      throw new ConflictError(
        "This checkout has already completed or cannot be cancelled. Refresh your billing status.",
      );
    }
    const result = await this.db
      .from("billing_markets")
      .update({ checkout_expires_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("checkout_nonce", data.checkout_nonce);
    if (result.error)
      throw new InternalServerError("Could not release checkout session");
    return data.checkout_session_id;
  }

  async portal(userId: string): Promise<string> {
    const market = await this.savedMarket(userId);
    const id = market && this.options.portals[market];
    if (!id)
      throw new BillingConfigurationError(
        "Billing portal is not configured for this market",
      );
    if (!(await this.getPrices(null, userId)).available)
      throw new BillingConfigurationError(
        "Billing portal configuration is invalid for this market",
      );
    return id;
  }

  planFromPrice(id: string): PurchasePlan | null {
    for (const prices of Object.values(this.options.prices))
      for (const [plan, price] of Object.entries(prices))
        if (price === id) return plan as PurchasePlan;
    return this.options.historicalPrices?.[id] ?? null;
  }

  private sign(payload: unknown): string {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encoded}.${createHmac("sha256", this.options.secret!).update(encoded).digest("hex")}`;
  }
  private verify(
    quote?: string,
  ): {
    market: BillingMarket;
    currency: string;
    plans: unknown;
    subject: string | null;
    expires: number;
  } | null {
    if (!quote || quote.length > 4096 || !this.options.secret) return null;
    const [encoded, signature, extra] = quote.split(".");
    if (extra || !signature || !/^[a-f0-9]{64}$/.test(signature)) return null;
    const expected = createHmac("sha256", this.options.secret)
      .update(encoded)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) return null;
    try {
      const value = JSON.parse(
        Buffer.from(encoded, "base64url").toString("utf8"),
      );
      return typeof value.expires === "number" &&
        value.expires > Date.now() &&
        value.expires <= Date.now() + 15 * 60_000
        ? value
        : null;
    } catch {
      return null;
    }
  }
}

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";
import Stripe from "stripe";
import {
  regionalPortalParameters,
  portalMatchesPrices,
  type PortalPlanPrice,
} from "../src/modules/billing/portal-setup";
import type {
  BillingMarket,
  PurchasePlan,
} from "../src/modules/billing/regional-pricing";

class SetupError extends Error {}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) {
    console.log(
      "Usage: npm run stripe:regional-portals [-- --create | --list]",
    );
    console.log(
      "Default: validate all six prices and any configured portals without writing to Stripe.",
    );
    console.log(
      "--create: create/reuse missing regional configurations and print their bpc_ IDs. Existing configurations are never modified.",
    );
    console.log(
      "--list: list existing portal configuration IDs and allowed prices without making changes. Only STRIPE_SECRET_KEY is required.",
    );
    return;
  }
  if (args.some((arg) => !["--create", "--list"].includes(arg)))
    throw new SetupError("Unknown option. Use --help.");
  if (args.includes("--create") && args.includes("--list"))
    throw new SetupError("Use --create or --list, not both.");
  const env: Record<string, string | undefined> = {};
  for (const name of [".env", ".env.local"]) {
    const filename = resolve(__dirname, "..", name);
    if (existsSync(filename)) Object.assign(env, parse(readFileSync(filename)));
  }
  Object.assign(env, process.env);
  const key = env.STRIPE_SECRET_KEY?.trim();
  if (!key || !/^(sk|rk)_(test|live)_/.test(key))
    throw new SetupError(
      "Set STRIPE_SECRET_KEY in backend/.env.local or the process environment.",
    );
  const mode = key.includes("_live_") ? "live" : "test";
  const stripe = new Stripe(key, {
    apiVersion: "2024-06-20",
    timeout: 20_000,
    maxNetworkRetries: 1,
  });
  console.log(
    `Stripe mode: ${mode}. Existing products, prices, subscriptions, and default portal settings are not modified.`,
  );
  if (args.includes("--list")) {
    let count = 0;
    for await (const configuration of stripe.billingPortal.configurations.list({
      limit: 100,
      expand: ["data.features.subscription_update.products"],
    })) {
      const priceIds = (
        configuration.features.subscription_update.products ?? []
      ).flatMap((product) => product.prices);
      console.log(
        `${configuration.id} | default=${configuration.is_default} | active=${configuration.active} | plan_changes=${configuration.features.subscription_update.enabled} | allowed_prices=${priceIds.join(",") || "none"}`,
      );
      count++;
    }
    if (!count)
      console.log("No portal configurations exist in this Stripe environment.");
    return;
  }
  const app = new URL(env.FRONTEND_APP_URL || "http://localhost:5173");
  if (
    mode === "live" &&
    (app.protocol !== "https:" ||
      ["localhost", "127.0.0.1"].includes(app.hostname))
  )
    throw new SetupError(
      "For live setup, set FRONTEND_APP_URL to your HTTPS application origin.",
    );
  const returnUrl =
    env.BILLING_PORTAL_RETURN_URL || `${app.origin}/app/pricing`;
  if (new URL(returnUrl).origin !== app.origin)
    throw new SetupError(
      "BILLING_PORTAL_RETURN_URL must use the FRONTEND_APP_URL origin.",
    );
  const plans: PurchasePlan[] = ["weekly", "monthly", "annual"];
  const markets: BillingMarket[] = ["GLOBAL", "TR"];
  const catalog = {} as Record<BillingMarket, PortalPlanPrice[]>;
  for (const market of markets) {
    catalog[market] = await Promise.all(
      plans.map(async (plan) => {
        const productName = `STRIPE_${plan.toUpperCase()}_PRODUCT_ID`;
        const productId =
          env[productName]?.trim() || env.STRIPE_PRODUCT_ID?.trim();
        const priceName = `STRIPE_${market === "TR" ? "TRY_" : ""}${plan.toUpperCase()}_PRICE_ID`;
        const priceId = env[priceName]?.trim();
        if (!productId || !/^prod_[A-Za-z0-9]+$/.test(productId))
          throw new SetupError(
            `Set ${productName} to this plan's prod_ ID (or STRIPE_PRODUCT_ID for a shared product).`,
          );
        if (!priceId || !/^price_[A-Za-z0-9]+$/.test(priceId))
          throw new SetupError(`Set ${priceName} to its price_ ID.`);
        const price = await stripe.prices.retrieve(priceId);
        const expectedCurrency = market === "TR" ? "try" : "usd";
        const expectedInterval = (
          { weekly: "week", monthly: "month", annual: "year" } as const
        )[plan];
        const actualProduct =
          typeof price.product === "string" ? price.product : price.product.id;
        if (
          !price.active ||
          actualProduct !== productId ||
          price.currency !== expectedCurrency ||
          price.recurring?.interval !== expectedInterval ||
          price.recurring.interval_count !== 1 ||
          !Number.isInteger(price.unit_amount) ||
          price.unit_amount! <= 0
        )
          throw new SetupError(
            `${priceName} must be an active ${expectedCurrency.toUpperCase()} price on ${productName}, recurring every one ${expectedInterval}, with a positive amount.`,
          );
        return { plan, productId, priceId };
      }),
    );
  }
  console.log(
    "All six prices validated against their plan products, currencies and billing periods.",
  );
  // Validate every explicitly configured portal before creating any new ones.
  const configured = new Map<
    BillingMarket,
    Stripe.BillingPortal.Configuration
  >();
  const variable = (market: BillingMarket) =>
    `STRIPE_${market === "TR" ? "TRY" : "USD"}_PORTAL_CONFIGURATION_ID`;
  for (const market of markets) {
    const id = env[variable(market)]?.trim();
    if (!id) continue;
    if (!/^bpc_[A-Za-z0-9]+$/.test(id))
      throw new SetupError(
        `${variable(market)} must be a bpc_ configuration ID.`,
      );
    const configuration =
      await stripe.billingPortal.configurations.retrieve(id, {
        expand: ["features.subscription_update.products"],
      });
    if (!portalMatchesPrices(configuration, catalog[market]))
      throw new SetupError(
        `${variable(market)} is inactive or offers prices outside its market. Create a separate configuration with the matching three prices.`,
      );
    configured.set(market, configuration);
  }
  for (const market of markets) {
    let configuration = configured.get(market);
    if (!configuration && args.includes("--create")) {
      const parameters = regionalPortalParameters(
        market,
        catalog[market],
        app.origin,
        returnUrl,
      );
      const fingerprint = createHash("sha256")
        .update(JSON.stringify(parameters))
        .digest("hex");
      for await (const candidate of stripe.billingPortal.configurations.list({
        limit: 100,
        expand: ["data.features.subscription_update.products"],
      })) {
        if (
          candidate.metadata?.integration ===
            parameters.metadata!.integration &&
          candidate.metadata?.setup_fingerprint === fingerprint &&
          portalMatchesPrices(candidate, catalog[market])
        ) {
          configuration = candidate;
          break;
        }
      }
      if (!configuration)
        configuration = await stripe.billingPortal.configurations.create(
          {
            ...parameters,
            expand: ["features.subscription_update.products"],
            metadata: {
              ...parameters.metadata,
              setup_fingerprint: fingerprint,
            },
          },
          {
            idempotencyKey: `cv-regional-portal-${mode}-${market}-${fingerprint}`,
          },
        );
    }
    if (configuration && !portalMatchesPrices(configuration, catalog[market]))
      throw new SetupError(
        `${variable(market)} did not validate after creation. Check its active status and allowed prices in Stripe.`,
      );
    if (configuration) console.log(`${variable(market)}=${configuration.id}`);
    else
      console.log(
        `${variable(market)} is missing. Run again with --create to create it.`,
      );
  }
  console.log(
    "Copy the configuration IDs into the matching backend environment. No environment files or deployments were changed.",
  );
}

void main().catch((error) => {
  // Stripe authentication errors can contain portions of credentials; omit their messages.
  if (error instanceof SetupError) console.error(error.message);
  else if (error instanceof Stripe.errors.StripeError)
    console.error(
      `Stripe request failed (${error.type}${error.code ? `, ${error.code}` : ""}). Check API-key permissions, object IDs and test/live mode.`,
    );
  else console.error("Portal setup failed. Check the configuration and retry.");
  process.exitCode = 1;
});

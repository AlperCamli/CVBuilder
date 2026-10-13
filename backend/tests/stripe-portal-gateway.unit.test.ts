import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { StripeBillingGateway } from "../src/modules/billing/stripe-gateway";

describe("Stripe portal catalog retrieval", () => {
  it("reads allowed prices when Stripe omits products from unexpanded responses", async () => {
    const allowedPrices = ["price_us_week", "price_us_month", "price_us_year"];
    const server = createServer((request, response) => {
      const url = new URL(request.url!, "http://localhost");
      const expanded = url.searchParams.get("expand[0]") === "features.subscription_update.products";
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        id: "bpc_us",
        object: "billing_portal.configuration",
        active: true,
        features: {
          subscription_update: {
            enabled: true,
            ...(expanded ? { products: [{ product: "prod_us", prices: allowedPrices }] } : {})
          }
        }
      }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const gateway = new StripeBillingGateway("sk_test_fixture");
      (gateway as unknown as { stripe: Stripe }).stripe = new Stripe("sk_test_fixture", {
        apiVersion: "2024-06-20",
        host: "127.0.0.1",
        port: (server.address() as AddressInfo).port,
        protocol: "http",
        maxNetworkRetries: 0
      });
      expect(await gateway.retrievePortalConfiguration("bpc_us")).toEqual({
        active: true,
        updates_enabled: true,
        price_ids: allowedPrices
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});

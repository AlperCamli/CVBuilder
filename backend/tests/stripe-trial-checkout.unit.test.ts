import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { StripeBillingGateway } from "../src/modules/billing/stripe-gateway";

describe("card-backed trial checkout", () => {
  it("requires card collection for trials and keeps immediate purchases distinct on the Stripe wire", async () => {
    const bodies: URLSearchParams[] = [];
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      bodies.push(new URLSearchParams(Buffer.concat(chunks).toString()));
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ id: "cs_test_owned", object: "checkout.session", url: "https://checkout.stripe.test/session", customer: "cus_owned", subscription: "sub_owned", status: "complete", payment_status: "no_payment_required", metadata: { app_user_id: "owner" } }));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    try {
      const gateway = new StripeBillingGateway("sk_test_fixture");
      (gateway as unknown as { stripe: Stripe }).stripe = new Stripe("sk_test_fixture", { apiVersion: "2024-06-20", host: "127.0.0.1", port: (server.address() as AddressInfo).port, protocol: "http", maxNetworkRetries: 0 });
      const input = { customer_id: "cus_owned", price_id: "price_weekly", success_url: "http://localhost/app/checkout?session_id={CHECKOUT_SESSION_ID}", cancel_url: "http://localhost/app/checkout?checkout=cancel", client_reference_id: "owner", metadata: { app_user_id: "owner" } };
      await gateway.createCheckoutSession({ ...input, trial_period_days: 3 });
      expect(bodies[0].get("payment_method_collection")).toBe("always");
      expect(bodies[0].get("payment_method_types[0]")).toBe("card");
      expect(bodies[0].get("subscription_data[trial_period_days]")).toBe("3");
      await gateway.createCheckoutSession({ ...input, trial_period_days: null });
      expect(bodies[1].has("subscription_data[trial_period_days]")).toBe(false);
      expect(await gateway.retrieveCheckoutSession("cs_test_owned")).toMatchObject({ status: "complete", payment_status: "no_payment_required", customer_id: "cus_owned", subscription_id: "sub_owned", metadata: { app_user_id: "owner" } });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});

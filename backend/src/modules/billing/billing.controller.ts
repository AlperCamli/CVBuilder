import { verifyGeoContext } from "./geo-context";
import type { AppConfig } from "../../shared/config/env";
import type { Request, Response } from "express";
import { UnauthorizedError, ValidationError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import type { BillingService } from "./billing.service";

const requireSession = (request: Request) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }

  return request.auth;
};

export class BillingController {
  constructor(private readonly billingService: BillingService, private readonly config?: AppConfig) {}

  private country(request: Request) {
    const trustedContextRequired = process.env.VERCEL === "1" || process.env.NODE_ENV === "production" || this.config?.appEnv === "production" || this.config?.appEnv === "staging";
    return verifyGeoContext(request, this.config?.billing.geoSecret ?? null, trustedContextRequired, this.config?.billing.developmentCountry);
  }

  getPrices = asyncHandler(async (request: Request, response: Response) => {
    response.setHeader("Cache-Control", "no-store");
    const data = await this.billingService.getPrices(this.country(request), request.auth?.appUser.id);
    sendSuccess(response, data);
  });

  getPlan = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.billingService.getBillingPlan(requireSession(request).appUser.id);
    sendSuccess(response, data);
  });

  getUsage = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.billingService.getBillingUsage(requireSession(request).appUser.id);
    sendSuccess(response, data);
  });

  getEntitlements = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.billingService.getBillingEntitlements(requireSession(request).appUser.id);
    sendSuccess(response, data);
  });

  postCheckout = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.billingService.createCheckoutSession(
      requireSession(request).appUser.id,
      request.body,
      this.country(request)
    );

    sendSuccess(response, data);
  });

  postCancelCheckout = asyncHandler(async (request: Request, response: Response) => { sendSuccess(response, await this.billingService.cancelCheckout(requireSession(request).appUser.id)); });

  postPortal = asyncHandler(async (request: Request, response: Response) => {
    const data = await this.billingService.createPortalSession(requireSession(request).appUser.id, request.body);
    sendSuccess(response, data);
  });

  postWebhooks = asyncHandler(async (request: Request, response: Response) => {
    const signature = request.header("stripe-signature");

    if (!signature) {
      throw new ValidationError("Stripe webhook endpoint requires stripe-signature header");
    }

    if (!Buffer.isBuffer(request.body)) {
      throw new ValidationError("Stripe webhook endpoint requires raw request body");
    }

    const data = await this.billingService.handleWebhook(request.body, signature);
    sendSuccess(response, data);
  });
}

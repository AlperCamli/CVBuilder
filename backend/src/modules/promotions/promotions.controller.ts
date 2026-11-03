import type { Request, Response } from "express";
import type { AppConfig } from "../../shared/config/env";
import { ForbiddenError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import { requestCountry } from "../billing/billing.controller";
import type { PromotionsService } from "./promotions.service";

export class PromotionsController {
  constructor(private readonly promotionsService: PromotionsService, private readonly config?: AppConfig) {}

  // An unsigned or stale geo context only loses the country fallback; the offer itself is informational
  // (checkout re-prices with its own signed context and quote).
  private country(request: Request): string | null {
    try {
      return requestCountry(request, this.config);
    } catch (error) {
      if (error instanceof ForbiddenError) return null;
      throw error;
    }
  }

  getOffer = asyncHandler(async (request: Request, response: Response) => {
    response.setHeader("Cache-Control", "no-store");
    sendSuccess(response, await this.promotionsService.getOffer(String(request.query.token), this.country(request)));
  });
}

import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import { parseMetricName, parseMetricQuery } from "./admin-analytics.contract";
import { toCsv } from "./admin-analytics.csv";
import type { AdminAnalyticsService } from "./admin-analytics.service";

const requireIdentity = (request: Request) => {
  if (!request.adminIdentity) {
    throw new UnauthorizedError();
  }

  return request.adminIdentity;
};

export class AdminAnalyticsController {
  constructor(private readonly service: AdminAnalyticsService) {}

  getMe = asyncHandler(async (request: Request, response: Response) => {
    sendSuccess(response, this.service.getMe(requireIdentity(request)));
  });

  getCatalog = asyncHandler(async (_request: Request, response: Response) => {
    sendSuccess(response, { metrics: await this.service.getCatalog() });
  });

  getMetric = asyncHandler(async (request: Request, response: Response) => {
    const identity = requireIdentity(request);
    const name = parseMetricName(request.params.name);
    const { params, format } = parseMetricQuery(request.query);

    const startedAt = Date.now();
    const result = await this.service.runMetric(name, params);
    request.log?.info(
      { admin: identity.email, metric: name, ms: Date.now() - startedAt, rows: result.rows.length },
      "Admin metric served"
    );

    if (format === "csv") {
      // name and dates are validated, so the filename needs no escaping.
      response
        .status(200)
        .set("Content-Type", "text/csv; charset=utf-8")
        .set("Content-Disposition", `attachment; filename="${name}_${params.from}_${params.to}.csv"`)
        .send(toCsv(result.columns, result.rows));
      return;
    }

    sendSuccess(response, { metric: name, rows: result.rows, generated_at: new Date().toISOString() });
  });
}

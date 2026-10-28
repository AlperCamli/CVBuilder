import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import { parseMetricName, parseMetricQuery, parsePeopleQuery } from "./admin-analytics.contract";
import { toCsv } from "./admin-analytics.csv";
import type { AdminAnalyticsService } from "./admin-analytics.service";

const requireIdentity = (request: Request) => {
  if (!request.adminIdentity) {
    throw new UnauthorizedError();
  }

  return request.adminIdentity;
};

// The pino-http request id, when it fits admin_app.log_access's request_id format.
const requestIdOf = (request: Request): string | null => {
  const id = (request as Request & { id?: unknown }).id;
  const text = typeof id === "string" || typeof id === "number" ? String(id) : "";
  return /^[-A-Za-z0-9_.:]{1,128}$/.test(text) ? text : null;
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

  // POST body. Every call is audited before any data is read; the raw `q` is never logged, and the database keeps only
  // its keyed hash.
  getPeople = asyncHandler(async (request: Request, response: Response) => {
    const identity = requireIdentity(request);
    const name = parseMetricName(request.params.name);
    const query = parsePeopleQuery(request.body);

    const startedAt = Date.now();
    const result = await this.service.runPeople(name, query, {
      adminEmail: identity.email ?? "",
      requestId: requestIdOf(request)
    });
    request.log?.info(
      { admin: identity.email, people: name, format: query.format, ms: Date.now() - startedAt, rows: result.rows.length },
      "Admin people served"
    );

    if (query.format === "csv") {
      const stamp = new Date().toISOString().slice(0, 10);
      response
        .status(200)
        .set("Content-Type", "text/csv; charset=utf-8")
        .set("Content-Disposition", `attachment; filename="${name}_${stamp}.csv"`)
        .set("X-Export-Truncated", result.truncated ? "true" : "false")
        .send(toCsv(result.columns, result.rows));
      return;
    }

    sendSuccess(response, {
      name,
      rows: result.rows,
      next_cursor: result.nextCursor,
      generated_at: new Date().toISOString()
    });
  });
}

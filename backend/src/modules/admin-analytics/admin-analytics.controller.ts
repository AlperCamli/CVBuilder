import type { Request, Response } from "express";
import { UnauthorizedError } from "../../shared/errors/app-error";
import { sendError, sendSuccess } from "../../shared/http/response";
import { asyncHandler } from "../../shared/utils/async-handler";
import {
  parseAlertEventId,
  parseAlertEventsQuery,
  parseAlertRuleId,
  parseAlertRuleInput,
  parseAlertRulePatch,
  parseAuditQuery
} from "./admin-alerts.contract";
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

// Who performs a write: the live admin email and the request id, both recorded in the audit row by the database.
const writeContextOf = (request: Request) => ({
  adminEmail: requireIdentity(request).email ?? "",
  requestId: requestIdOf(request)
});

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

  // ---------------------------------------------------------------------------
  // Phase 5: alerts, recompute, audit log
  // ---------------------------------------------------------------------------

  listAlertRules = asyncHandler(async (_request: Request, response: Response) => {
    sendSuccess(response, { rules: await this.service.listAlertRules() });
  });

  createAlertRule = asyncHandler(async (request: Request, response: Response) => {
    const context = writeContextOf(request);
    const rule = parseAlertRuleInput(request.body);
    const created = await this.service.createAlertRule(context, rule);
    request.log?.info({ admin: context.adminEmail, action: "alert.rule.create", rule: created.id }, "Admin alert rule written");
    sendSuccess(response, created, { statusCode: 201 });
  });

  updateAlertRule = asyncHandler(async (request: Request, response: Response) => {
    const context = writeContextOf(request);
    const id = parseAlertRuleId(request.params.id);
    const patch = parseAlertRulePatch(request.body);
    const updated = await this.service.updateAlertRule(context, id, patch);
    request.log?.info({ admin: context.adminEmail, action: "alert.rule.update", rule: id }, "Admin alert rule written");
    sendSuccess(response, updated);
  });

  deleteAlertRule = asyncHandler(async (request: Request, response: Response) => {
    const context = writeContextOf(request);
    const id = parseAlertRuleId(request.params.id);
    await this.service.deleteAlertRule(context, id);
    request.log?.info({ admin: context.adminEmail, action: "alert.rule.delete", rule: id }, "Admin alert rule written");
    response.status(204).send();
  });

  listAlertEvents = asyncHandler(async (request: Request, response: Response) => {
    const { status, limit } = parseAlertEventsQuery(request.query);
    sendSuccess(response, { events: await this.service.listAlertEvents(status, limit) });
  });

  ackAlertEvent = asyncHandler(async (request: Request, response: Response) => {
    const context = writeContextOf(request);
    const id = parseAlertEventId(request.params.id);
    const event = await this.service.ackAlertEvent(context, id);
    request.log?.info({ admin: context.adminEmail, action: "alert.event.ack", event: id }, "Admin alert event acknowledged");
    sendSuccess(response, event);
  });

  getAlertSummary = asyncHandler(async (_request: Request, response: Response) => {
    sendSuccess(response, await this.service.alertSummary());
  });

  // 202 when queued; 429 (error envelope, details = the throttle) while a run is open or within 5 minutes of the last.
  requestRecompute = asyncHandler(async (request: Request, response: Response) => {
    const { adminEmail } = writeContextOf(request);
    const result = await this.service.requestRecompute(adminEmail);
    request.log?.info({ admin: adminEmail, action: "recompute.request", status: result.status, run: result.run_id }, "Admin recompute requested");
    if (result.status === "queued") {
      sendSuccess(response, { status: "queued", run_id: result.run_id }, { statusCode: 202 });
      return;
    }
    const retryAfter = Math.max(1, Math.ceil(result.retry_after_seconds));
    response.set("Retry-After", String(retryAfter));
    sendError(response, {
      statusCode: 429,
      code: "RATE_LIMITED",
      message: "A recompute ran or was requested recently. Try again later.",
      details: { status: "throttled", run_id: result.run_id, retry_after_seconds: retryAfter }
    });
  });

  getRecomputeStatus = asyncHandler(async (_request: Request, response: Response) => {
    sendSuccess(response, await this.service.recomputeStatus());
  });

  getAuditRecent = asyncHandler(async (request: Request, response: Response) => {
    const context = writeContextOf(request);
    const { limit } = parseAuditQuery(request.query);
    const rows = await this.service.readAuditRecent(context, limit);
    request.log?.info({ admin: context.adminEmail, action: "audit.read", rows: rows.length }, "Admin audit log served");
    // Who did what, when, to whom: params (filters, search hashes, rule bodies) never leave the backend.
    const entries = rows.map((row) => ({
      id: row.id,
      at: row.at,
      admin_email: row.admin_email,
      action: row.action,
      target_user_id: row.target_user_id ?? null,
      people_function: row.people_function ?? null,
      request_id: row.request_id ?? null
    }));
    sendSuccess(response, { entries, generated_at: new Date().toISOString() });
  });
}

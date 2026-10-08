import type {ApiClient, RequestOptions} from "./api-client";
import {trackEvent} from "./analytics";

function actionFor(method: string, path: string): string | null {
  if (method === "GET") return null;
  const route = path.split(/[?#]/)[0];
  if (/^\/ai\//.test(route)) {
    if (/\/suggestions\/[^/]+\/(apply|reject)$/.test(route)) return route.endsWith("/apply") ? "ai_suggestion_applied" : "ai_suggestion_rejected";
    if (/\/blocks\/suggest$/.test(route)) return "ai_block_suggestion";
    if (/\/import-improve$/.test(route)) return "ai_cv_improvement";
    if (/\/cover-letters\/generate$/.test(route)) return "ai_cover_letter_generation";
    if (/\/tailoring-runs\//.test(route)) return "ai_tailoring_request";
    if (/\/job-analysis$/.test(route)) return "ai_job_analysis";
    if (/\/follow-up-questions$/.test(route)) return "ai_follow_up_questions";
    if (/\/tailored-cv-draft$/.test(route)) return "ai_tailored_draft";
    return null;
  }
  if (/^\/(master-cvs|tailored-cvs)(\/|$)/.test(route)) {
    if (/\/exports/.test(route)) return "cv_export_request";
    if (method === "DELETE") return "cv_deleted";
    if (method === "PUT" || method === "PATCH") return "cv_updated";
    return "cv_created";
  }
  if (/^\/imports\/[^/]+\/parse$/.test(route)) return "cv_parse";
  if (/^\/imports\/[^/]+\/create-master-cv$/.test(route)) return "cv_created_from_import";
  if (/^\/imports\/[^/]+\/result$/.test(route)) return "parsed_cv_updated";
  if (/^\/jobs(\/|$)/.test(route)) return route.includes("/cover-letter") ? "cover_letter_created" : "job_updated";
  if (/^\/cover-letters\//.test(route)) return route.includes("/exports") ? "cover_letter_export_request" : "cover_letter_updated";
  if (/^\/revisions\/[^/]+\/restore$/.test(route)) return "cv_revision_restored";
  if (route === "/me") return "profile_updated";
  if (route === "/billing/portal") return "billing_portal_opened";
  return null;
}

// Track confirmed write outcomes across app features. Bodies, IDs, raw paths,
// response content and error text are never supplied to Analytics.
export function withProductAnalytics(client: ApiClient): ApiClient {
  const run = async <T>(method: string, path: string, request: () => Promise<T>): Promise<T> => {
    const action = actionFor(method, path);
    const report = (result: string) => {if (action) {try {trackEvent("product_action", {action, result});} catch { /* Analytics cannot prevent an application save. */ }}};
    try { const response = await request(); report("success"); return response; }
    catch (error) {report("failure"); throw error;}
  };
  return {
    get: client.get,
    post: <T, B = unknown>(path: string, body?: B, options?: RequestOptions) => run("POST", path, () => client.post<T,B>(path,body,options)),
    put: <T, B = unknown>(path: string, body?: B, options?: RequestOptions) => run("PUT", path, () => client.put<T,B>(path,body,options)),
    patch: <T, B = unknown>(path: string, body?: B, options?: RequestOptions) => run("PATCH", path, () => client.patch<T,B>(path,body,options)),
    delete: <T>(path: string, options?: RequestOptions) => run("DELETE", path, () => client.delete<T>(path,options)),
  };
}

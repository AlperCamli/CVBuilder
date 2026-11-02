import { ForbiddenError } from "../../shared/errors/app-error";
import type { FreeTierUse } from "../usage/usage.repository";
import type { GatedAction } from "./entitlements.types";

// Which paywall the frontend shows for a refused request.
export type PaywallSurface = "export" | "ai" | "tailoring" | "cover_letter" | "other";

export type AccessAction = GatedAction | "app_access";

// How a request is treated for an account without an active or trialing subscription.
// - free: manual workspace (dashboard, CVs, imports, jobs, templates, preview rendering).
// - free_use: allowed once per account; the service claims the marker atomically.
// - free_session: allowed only on the account's free tailoring session.
// - paid: needs a trial or Pro.
export type AppRequestPolicy =
  | { kind: "free" }
  | { kind: "free_use"; use: FreeTierUse }
  | { kind: "free_session"; session_id: string }
  | { kind: "paid"; action: AccessAction; surface: PaywallSurface };

const paid = (action: AccessAction, surface: PaywallSurface): AppRequestPolicy => ({ kind: "paid", action, surface });
const FREE: AppRequestPolicy = { kind: "free" };

const APP_ROUTE = /^\/(dashboard|master-cvs|tailored-cvs|jobs|cover-letters|cover-letter-exports|cv-revisions|revisions|ai|rendering|cv-photos|exports|imports)(\/|$)/;
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const surfaceForAction = (action: AccessAction): PaywallSurface => {
  if (action === "export_pdf" || action === "export_docx") return "export";
  if (action === "tailored_cv_generation") return "tailoring";
  if (action === "ai_action") return "ai";
  return "other";
};

// The single route map for free accounts. Returns null for routes outside the application
// (account, billing, privacy, onboarding imports reads), which never need a subscription.
export function classifyAppRequest(method: string, rawPath: string): AppRequestPolicy | null {
  // Express routes accept case variations and a trailing slash by default.
  const path = rawPath.toLowerCase().replace(/\/+$/, "") || "/";
  if (!APP_ROUTE.test(path)) return null;
  const read = READ_METHODS.has(method);

  // File downloads: creating an export, its signed-URL detail and download endpoints.
  const exportFormat = /^\/(?:master-cvs|tailored-cvs|cover-letters)\/[^/]+\/exports\/(pdf|docx)$/.exec(path)?.[1];
  if (exportFormat && !read) return paid(exportFormat === "pdf" ? "export_pdf" : "export_docx", "export");
  if (/^\/(?:exports|cover-letter-exports)\/[^/]+(?:\/download)?$/.test(path)) return paid("export_pdf", "export");

  if (path.startsWith("/ai/") || path === "/ai") {
    if (read) return FREE;
    if (path === "/ai/import-improve") return { kind: "free_use", use: "improve" };
    if (path === "/ai/tailoring-sessions") return { kind: "free_use", use: "tailoring" };
    if (path === "/ai/tailoring-preferences") return FREE;
    const session = /^\/ai\/tailoring-sessions\/([^/]+)\/.+$/.exec(path)?.[1];
    if (session) return { kind: "free_session", session_id: session };
    if (path === "/ai/cover-letters/generate") return paid("ai_action", "cover_letter");
    if (/^\/ai\/(?:tailoring-runs|job-analysis|follow-up-questions|tailored-cv-draft)(\/|$)/.test(path)) return paid("tailored_cv_generation", "tailoring");
    return paid("ai_action", "ai");
  }
  if (/^\/master-cvs\/[^/]+\/translations(\/|$)/.test(path) && !read) return paid("ai_action", "ai");
  return FREE;
}

export const trialRequiredError = (action: AccessAction, surface: PaywallSurface, message = "Activate your 3-day free trial or purchase Pro to continue.") =>
  new ForbiddenError(message, { reason: "trial_required", action, surface });

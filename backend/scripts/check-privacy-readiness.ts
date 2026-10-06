import { createClient } from "@supabase/supabase-js";
import { getConfig } from "../src/shared/config/env";
import { privacyConfig } from "../src/modules/privacy/privacy.config";

// Read-only checks against the active .env/.env.local or deployment environment.
// Never print credentials, identities, CVs, provider payloads or signed URLs.
async function main() {
  const app = getConfig();
  const privacy = privacyConfig();
  const blockers: string[] = [];
  const check = (label: string, passed: boolean, fix: string) => {
    console.log(`${passed ? "PASS" : "BLOCKED"}: ${label}${passed ? "" : ` — ${fix}`}`);
    if (!passed) blockers.push(label);
  };
  console.log("Checking active runtime configuration. .env.example is a template and is not loaded.");
  console.log(`Configured AI provider: ${app.ai.provider}`);
  check("Operator identity/contact configured", !!privacy.controller && !!privacy.address && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(privacy.contact), "Copy the supplied privacy fields into .env.local or deployment variables.");
  const required = ["supabase", "vercel", ...(privacy.ai_required ? [app.ai.provider] : []), ...(process.env.STRIPE_SECRET_KEY ? ["stripe"] : [])];
  for (const id of required) check(`Reviewed provider entry: ${id}`, privacy.processors.some(row => row.id === id), "Complete PRIVACY_PROCESSORS_JSON with the actual purpose, countries, retention and safeguards.");
  check("Operator/privacy review approved", process.env.PRIVACY_REVIEW_APPROVED === "true", "Set PRIVACY_REVIEW_APPROVED=true after the documented review.");
  if (privacy.ai_required) {
    check("Actual AI provider approved", process.env.PRIVACY_AI_PROVIDER_APPROVED === "true" && app.ai.provider !== "mock", "Complete the configured provider review before setting PRIVACY_AI_PROVIDER_APPROVED=true.");
    const key = ({ openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY", mock: "" })[app.ai.provider];
    check("AI credential configured", !!key && !!process.env[key], "Configure the selected provider credential; this check does not contact the provider.");
  }
  check("Maintenance secret configured", !!process.env.CRON_SECRET?.trim(), "Configure CRON_SECRET in the backend environment.");
  const db = createClient(app.supabase.url, app.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) },
  });
  const checks = await Promise.allSettled([
    // limit(0) reads schema without returning user rows; HEAD can obscure
    // PostgREST error bodies when a relation or column does not yet exist.
    db.from("users").select("id,ai_processing,deletion_requested_at,processing_restricted_at").limit(0),
    db.from("guest_imports").select("id,ai_processing,deleted_at,privacy_revision").limit(0),
    db.from("privacy_jobs").select("id").limit(0),
    db.from("privacy_receipts").select("id").limit(0),
    db.from("privacy_cleanup_health").select("initialized_at,last_success_at").eq("id", true).maybeSingle(),
    db.storage.listBuckets(),
  ]);
  for (let i = 0; i < 5; i++) {
    const result = checks[i];
    check(`Database privacy schema: ${["users", "guest_imports", "privacy_jobs", "privacy_receipts", "privacy_cleanup_health"][i]}`, result.status === "fulfilled" && !result.value.error, "Apply 20261006160000_privacy_controls.sql, then rerun this check.");
  }
  const health = checks[4];
  const data = health.status === "fulfilled" ? health.value.data as { initialized_at: string; last_success_at: string | null } | null : null;
  const heartbeat = data?.last_success_at ?? data?.initialized_at;
  check("Maintenance heartbeat within 30 hours", !!heartbeat && Date.now() - Date.parse(heartbeat) <= 30 * 3_600_000, "Apply the migration and run the protected cleanup endpoint; verify the deployed daily schedule.");
  const buckets = checks[5];
  for (const id of ["imports", "exports", "cv-assets"]) {
    const bucket = buckets.status === "fulfilled" && !buckets.value.error ? (buckets.value.data as { id: string; public: boolean }[]).find(row => row.id === id) : undefined;
    check(`Private storage bucket: ${id}`, !!bucket && !bucket.public, "Verify bucket existence and private access policies.");
  }
  console.log(`Optional analytics: ${privacy.analytics_enabled ? "configured for user opt-in" : "disabled; requires a reviewed google-analytics entry and frontend measurement ID"}.`);
  console.log(blockers.length ? `NOT READY: ${blockers.length} blocking checks. Gates were not changed.` : "Runtime activation checks pass. Verify the deployed schedule and live integration checks before release; this is not legal certification.");
  process.exitCode = blockers.length ? 1 : 0;
}
void main().catch(() => { console.error("Readiness check failed. Check runtime configuration/connectivity; no sensitive details logged."); process.exitCode = 1; });

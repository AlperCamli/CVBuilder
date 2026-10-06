import { AppError, ForbiddenError } from "../../shared/errors/app-error";

export const NOTICE_VERSION = "2026-10-06.2";
export function privacyConfig() {
  const verified = process.env.PRIVACY_REVIEW_APPROVED === "true";
  const controller = (process.env.PRIVACY_CONTROLLER_NAME ?? "").trim();
  const address = (process.env.PRIVACY_CONTROLLER_ADDRESS ?? "").trim();
  const contact = (process.env.PRIVACY_CONTACT_EMAIL ?? "").trim();
  const aiRequired = process.env.PRIVACY_AI_REQUIRED !== "false";
  const provider = process.env.AI_PROVIDER ?? "mock";
  const providers = { openai: "OpenAI", gemini: "Google Gemini", anthropic: "Anthropic", mock: "No external AI provider" };
  let processors: { id: string; name: string; purpose: string; countries: string; retention: string; safeguards: string }[] = [];
  try {
    const parsed = JSON.parse(process.env.PRIVACY_PROCESSORS_JSON ?? "[]");
    if (Array.isArray(parsed) && parsed.every(row => ["id", "name", "purpose", "countries", "retention", "safeguards"].every(key => typeof row?.[key] === "string" && row[key].trim()))) processors = parsed;
  } catch { /* unverified arrangements remain disabled */ }
  const ready = verified && !!controller && !!address && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) && ["supabase", "vercel"].every(id => processors.some(row => row.id === id));
  const aiReady = ready && process.env.PRIVACY_AI_PROVIDER_APPROVED === "true" && provider !== "mock" && processors.some(row => row.id === provider);
  return {
    notice_version: NOTICE_VERSION, controller, address, contact,
    brand: (process.env.PRIVACY_BRAND_NAME ?? "JobSpecificCV").trim(),
    country: (process.env.PRIVACY_CONTROLLER_COUNTRY ?? "").trim(),
    hosting_region: (process.env.PRIVACY_HOSTING_REGION ?? "").trim(),
    ai_required: aiRequired,
    collection_enabled: ready && (!aiRequired || aiReady),
    processors,
    analytics_enabled: ready && processors.some(row => row.id === "google-analytics"),
    ai_enabled: aiReady,
    ai_provider: providers[provider as keyof typeof providers] ?? "Unconfigured provider",
    ai_provider_key: provider,
  };
}
export function assertCollectionEnabled() {
  if (!privacyConfig().collection_enabled) throw new AppError({ statusCode: 503, code: "PRIVACY_UNAVAILABLE", message: "CV uploads are temporarily unavailable while privacy arrangements are being verified. Account privacy settings, data download and deletion controls remain available." });
}
export function assertProviderEnabled() {
  if (!privacyConfig().ai_enabled) throw new ForbiddenError("AI processing is currently unavailable. Your privacy settings, data download and deletion controls remain available.");
}
export type PrivacyPreferences = { ai_processing: boolean; analytics: boolean; privacy_revision: number };

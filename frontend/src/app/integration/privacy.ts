import { createApiClient } from "./api-client";
import { integrationConfig } from "./config";
import { supabase } from "./supabase-client";
import { ApiClientError } from "./api-error";

export const NOTICE_VERSION = "2026-10-06.2";
export const CONSENT_KEY = "cv-builder:privacy-choices";
export const PRIVACY_EVENT = "cv-builder:privacy-change";
export interface PrivacyConfig {
  notice_version: string; controller: string; address: string; contact: string;
  brand?: string; country?: string; hosting_region?: string; ai_required?: boolean;
  processors: { id: string; name: string; purpose: string; countries: string; retention: string; safeguards: string }[];
  analytics_enabled: boolean;
  collection_enabled: boolean; ai_enabled: boolean; ai_provider: string;
}
export interface PrivacyChoices { analytics: boolean; ai_processing: boolean; notice_version: string }
export type AnalyticsChoice = Pick<PrivacyChoices, "analytics" | "notice_version">;
export const ACCOUNT_READY_EVENT = "cv-builder:account-ready";
export interface Preferences { analytics: boolean; ai_processing: boolean; privacy_revision: number }
export const privacyApi = createApiClient({ baseUrl: integrationConfig.apiBaseUrl, getAccessToken: async () => (await supabase.auth.getSession()).data.session?.access_token ?? null });
export const getPrivacyConfig = () => privacyApi.get<PrivacyConfig>("/privacy/config");
export const hasGlobalPrivacyControl = () => typeof navigator !== "undefined" && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
export function readAnalyticsChoice(): boolean | null {
  if (hasGlobalPrivacyControl()) return false;
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? "null");
    if (value?.version === NOTICE_VERSION && typeof value.analytics === "boolean" && Date.parse(value.expires_at) > Date.now()) return value.analytics;
  } catch { /* unknown is denied */ }
  return null;
}
export const analyticsAllowed = () => readAnalyticsChoice() === true;
export function saveAnalyticsChoice(accepted: boolean, options: { notify?: boolean; pending?: boolean; expectedSnapshot?: string } = {}) {
  if (options.expectedSnapshot !== undefined && localStorage.getItem(CONSENT_KEY) !== options.expectedSnapshot) return null;
  const analytics = accepted && !hasGlobalPrivacyControl();
  const snapshot = JSON.stringify({ version: NOTICE_VERSION, analytics, pending_sync: options.pending ?? false, expires_at: new Date(Date.now() + 180 * 86_400_000).toISOString() });
  localStorage.setItem(CONSENT_KEY, snapshot);
  if (options.notify !== false) window.dispatchEvent(new Event(PRIVACY_EVENT));
  return snapshot;
}
export function markBrowserChoicePending() {
  const record = JSON.parse(localStorage.getItem(CONSENT_KEY) ?? "null");
  if (!record) return null;
  const snapshot = JSON.stringify({...record, pending_sync: true});
  localStorage.setItem(CONSENT_KEY, snapshot);
  return snapshot;
}
export function openPrivacyChoices() { window.dispatchEvent(new Event("cv-builder:open-privacy")); }
export function notifyAiChoiceChanged() { window.dispatchEvent(new Event("cv-builder:ai-privacy-change")); }
export function choices(ai_processing = false): PrivacyChoices { return { ai_processing, analytics: analyticsAllowed(), notice_version: NOTICE_VERSION }; }
export async function syncBrowserChoice() {
  const analytics = readAnalyticsChoice();
  if (analytics === null) return;
  const input = {analytics, notice_version: NOTICE_VERSION};
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    await privacyApi.patch("/me/privacy", input, {keepalive: true});
  }
  // Import lazily to avoid a circular dependency during module initialization.
  const { readGuestUpload, updateGuestPrivacy } = await import("./guest-import");
  const guest = readGuestUpload();
  if (guest) {
    try { await updateGuestPrivacy(guest, input); }
    catch (error) {
      // Claim may already have transferred receipts to the account. Do not
      // clear the proof here: the handoff can still need its idempotent replay.
      if (!(data.session && error instanceof ApiClientError && error.status === 404)) throw error;
    }
  }
  return analytics;
}

export function consentSyncPending() {
  try { return JSON.parse(localStorage.getItem(CONSENT_KEY) ?? "null")?.pending_sync === true; }
  catch { return false; }
}

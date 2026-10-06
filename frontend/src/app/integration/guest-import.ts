import { createApiClient } from "./api-client";
import { integrationConfig } from "./config";
import { supabase } from "./supabase-client";
import type { OnboardingAnswers } from "../onboarding/pre-signup-questions";

const KEY = "cv-builder:guest-import";
export const ONBOARDING_RESUME_PATH = "/app/onboarding";
export interface GuestUpload {
  id: string;
  guest_token: string;
  expires_at: string;
  original_filename: string;
  answers: OnboardingAnswers;
  step: "questions" | "signup";
  question: number;
}
export interface GuestStatus {
  status: "uploaded" | "parsing" | "parsed" | "failed" | "claimed";
  error_message: string | null;
  retry_available: boolean;
  can_resume: boolean;
}
export function readGuestUpload(): GuestUpload | null {
  if (typeof window === "undefined") return null;
  try {
    const row = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (
      row &&
      typeof row.id === "string" &&
      /^[\da-f-]{36}$/i.test(row.id) &&
      typeof row.guest_token === "string" &&
      /^[A-Za-z0-9_-]{43}$/.test(row.guest_token) &&
      Date.parse(row.expires_at) > Date.now() &&
      row.answers &&
      typeof row.answers === "object"
    )
      return row;
  } catch {
    /* corrupt or unavailable browser storage */
  }
  clearGuestUpload();
  return null;
}
export function saveGuestUpload(row: GuestUpload) {
  // Persist the proof before starting auth; report unavailable storage instead
  // of silently losing the CV when OAuth leaves the page.
  localStorage.setItem(KEY, JSON.stringify(row));
}
export function clearGuestUpload() {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* unavailable */
    }
  }
}
const client = createApiClient({
  baseUrl: integrationConfig.apiBaseUrl,
  getAccessToken: async () => null,
});
const authenticated = createApiClient({
  baseUrl: integrationConfig.apiBaseUrl,
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});
const options = (row: GuestUpload) => ({
  headers: { "X-Guest-Token": row.guest_token },
});
export async function uploadGuestCv(file: File) {
  const mime = /\.pdf$/i.test(file.name)
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const created = await client.post<{
    id: string;
    guest_token: string;
    expires_at: string;
    upload: { storage_bucket: string; storage_path: string; token: string };
  }>("/guest-imports", {
    original_filename: file.name,
    mime_type: mime,
    size_bytes: file.size,
  });
  const { error } = await supabase.storage
    .from(created.upload.storage_bucket)
    .uploadToSignedUrl(
      created.upload.storage_path,
      created.upload.token,
      file,
      { contentType: mime },
    );
  if (error) throw error;
  const row: GuestUpload = {
    id: created.id,
    guest_token: created.guest_token,
    expires_at: created.expires_at,
    original_filename: file.name,
    answers: {},
    step: "questions",
    question: 0,
  };
  saveGuestUpload(row);
  return row;
}
export const getGuestStatus = (row: GuestUpload) =>
  client.get<GuestStatus>(`/guest-imports/${row.id}`, options(row));
const processing = new Map<string, Promise<GuestStatus>>();
export function processGuestCv(row: GuestUpload) {
  const current = processing.get(row.id);
  if (current) return current;
  const request = client
    .post<GuestStatus>(`/guest-imports/${row.id}/process`, {}, options(row))
    .finally(() => processing.delete(row.id));
  processing.set(row.id, request);
  return request;
}
// Serialize saves so a slower answer request cannot overwrite a newer selection.
let saving: Promise<unknown> = Promise.resolve();
export function saveGuestAnswers(row: GuestUpload, answers: OnboardingAnswers) {
  saving = saving
    .catch(() => undefined)
    .then(() =>
      client.patch(`/guest-imports/${row.id}/answers`, answers, options(row)),
    );
  return saving;
}
export const claimGuestCv = (row: GuestUpload) =>
  authenticated.post<{
    import_id: string;
    original_filename: string;
    answers: OnboardingAnswers;
  }>(`/guest-imports/${row.id}/claim`, {}, options(row));

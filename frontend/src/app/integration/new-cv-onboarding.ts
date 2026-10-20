import { PRE_SIGNUP_QUESTIONS, type OnboardingAnswers } from "../onboarding/pre-signup-questions";
import type { Locale } from "../localization/i18n";
import type { BackendApi } from "./backend-api";

const KEY = "cv-builder:new-cv-onboarding";
export interface NewCvOnboarding {
  id: string;
  expiresAt: number;
  language: Locale;
  answers: OnboardingAnswers;
  step: "questions" | "signup";
  question: number;
  accountId?: string;
  masterCvId?: string;
}

export function readNewCvOnboarding(): NewCvOnboarding | null {
  if (typeof window === "undefined") return null;
  try {
    const row = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (row && typeof row.id === "string" && typeof row.expiresAt === "number" && row.expiresAt > Date.now()
      && (row.language === "en" || row.language === "tr") && (row.step === "questions" || row.step === "signup")
      && Number.isInteger(row.question) && row.question >= 0 && row.question < PRE_SIGNUP_QUESTIONS.length
      && row.answers && typeof row.answers === "object" && !Array.isArray(row.answers)
      && Object.entries(row.answers).every(([id, value]) => PRE_SIGNUP_QUESTIONS.some(question => question.id === id && question.options.some(option => option.value === value)))
      && (row.accountId === undefined || typeof row.accountId === "string")
      && (row.masterCvId === undefined || (typeof row.masterCvId === "string" && typeof row.accountId === "string"))) return row;
  } catch { /* Invalid or unavailable storage cannot resume a signup. */ }
  clearNewCvOnboarding();
  return null;
}

export function saveNewCvOnboarding(row: NewCvOnboarding) {
  // Only questionnaire enums and the handoff cursor; no CV contents or signup fields.
  localStorage.setItem(KEY, JSON.stringify(row));
}

export function clearNewCvOnboarding() {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(KEY); } catch { /* Unavailable storage. */ }
}

// Share an in-flight handoff across effect replays. Persist the created ID before
// refreshing account state so a retry opens the same document.
const pending = new Map<string, Promise<string>>();
export function completeNewCvOnboarding(row: NewCvOnboarding, accountId: string, api: Pick<BackendApi, "patchOnboardingAnswers" | "createMasterCv">): Promise<string> {
  const key = `${row.id}:${accountId}`;
  const current = pending.get(key);
  if (current) return current;
  const request = (async () => {
    const draft = readNewCvOnboarding();
    if (!draft || draft.id !== row.id) throw new Error("Please start your new CV again.");
    if (draft.accountId && draft.accountId !== accountId) throw new Error("This CV setup belongs to another account. Please start again.");
    saveNewCvOnboarding({ ...draft, accountId });
    await api.patchOnboardingAnswers(draft.answers);
    if (draft.masterCvId) return draft.masterCvId;
    const created = await api.createMasterCv({ title: "My Main CV", language: draft.language });
    saveNewCvOnboarding({ ...draft, accountId, masterCvId: created.id });
    return created.id;
  })().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

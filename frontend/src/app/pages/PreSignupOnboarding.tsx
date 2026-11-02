import { SupportHelp } from "../components/SupportHelp";
import { i18n, documentLocale, publicPath, translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { getPrivacyConfig, choices, type PrivacyConfig } from "../integration/privacy";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  LockKeyhole,
  Mail,
  RefreshCw,
  RotateCcw,
  Upload,
} from "lucide-react";
import {
  PRE_SIGNUP_QUESTIONS,
  type OnboardingAnswers,
} from "../onboarding/pre-signup-questions";
import { AuthProvider, useAuth } from "../integration/auth-context";
import {
  clearGuestUpload,
  deleteGuestUpload,
  updateGuestPrivacy,
  getGuestStatus,
  ONBOARDING_RESUME_PATH,
  processGuestCv,
  readGuestUpload,
  saveGuestAnswers,
  saveGuestUpload,
  uploadGuestCv,
  type GuestReviewPreview,
  type GuestStatus,
  type GuestUpload,
} from "../integration/guest-import";
import { ONBOARDING_STEPS } from "../onboarding/onboarding-steps";
import {
  AUTO_ADVANCE_MS,
  PARSE_GIVE_UP_MS,
  PARSE_SLOW_MS,
  QUESTION_FUNNEL_DETAIL,
  isImageBasedReview,
  parsingStage,
  phaseFromStatus,
  previewKind,
  remainingSeconds,
  type ProcessingPhase,
} from "../onboarding/onboarding-flow";
import { ScorePreview } from "../onboarding/ScorePreview";
import { clearNewCvOnboarding, readNewCvOnboarding, recordNewCvStart, saveNewCvOnboarding, type NewCvOnboarding } from "../integration/new-cv-onboarding";
import { stashPostAuthRedirect } from "../integration/post-auth-redirect";
import { trackEvent } from "../integration/analytics";
import { trackFunnelEvent, type FunnelEvent } from "../integration/funnel-events";
import { supabase } from "../integration/supabase-client";
import { AiUploadDisclosure } from "../components/AiUploadDisclosure";
import "./pre-signup-onboarding.css";

import { rememberOnboardingTemplate } from "../integration/subscription-flow";

type Stage = "upload" | "questions" | "signup";
const GIVE_UP_MESSAGE = "Your CV is taking too long to analyze. Try another file, or create a new CV instead.";
const RESEND_COOLDOWN_SECONDS = 60;

function AnalysisStatus({ phase, elapsedMs, questionsLeft, slow, onAnotherFile, onCreateNew }: {
  phase: ProcessingPhase; elapsedMs: number; questionsLeft?: number; slow: boolean; onAnotherFile: () => void; onCreateNew: () => void;
}) {
  useTranslation();
  if (phase === "ready") {
    return (
      <p className="ob-analysis is-ready" role="status">
        <CheckCircle2 size={16} aria-hidden="true" />
        {questionsLeft === undefined
          ? t("Your score is ready")
          : questionsLeft === 1
            ? t("Your score is ready · 1 question left")
            : t("Your score is ready · {{count}} questions left", { count: questionsLeft })}
      </p>
    );
  }
  if (phase !== "parsing") return null;
  return (
    <div className="ob-analysis is-parsing" role="status">
      <p><Loader2 size={16} className="animate-spin" aria-hidden="true" />{t(parsingStage(elapsedMs))}</p>
      <span className="ob-indeterminate" aria-hidden="true"><span /></span>
      {slow && (
        <p className="ob-analysis-slow">
          {t("This is taking longer than usual. You can keep going while we finish.")}{" "}
          <button type="button" className="ob-text-button" onClick={onAnotherFile}>{t("Try another file")}</button>
          {" · "}
          <button type="button" className="ob-text-button" onClick={onCreateNew}>{t("Create a new CV instead")}</button>
        </p>
      )}
    </div>
  );
}

function AnalysisFailed({ message, retryAvailable, busy, onRetry, onAnotherFile, onCreateNew }: {
  message: string; retryAvailable: boolean; busy: boolean; onRetry: () => void; onAnotherFile: () => void; onCreateNew: () => void;
}) {
  useTranslation();
  return (
    <div className="ob-analysis-failed" role="alert">
      <h2>{t("We couldn't read this CV")}</h2>
      <p>{t(message)}</p>
      <div className="ob-failed-actions">
        <button type="button" className="ob-primary" disabled={busy} onClick={onAnotherFile}>
          <Upload size={16} aria-hidden="true" />{t("Try another file")}
        </button>
        <button type="button" className="ob-secondary" disabled={busy} onClick={onCreateNew}>
          <FileText size={16} aria-hidden="true" />{t("Continue without upload (create a new CV)")}
        </button>
        {retryAvailable && (
          <button type="button" className="ob-text-button" disabled={busy} onClick={onRetry}>
            <RotateCcw size={14} aria-hidden="true" />{t("Retry analysis")}
          </button>
        )}
      </div>
      <SupportHelp topic="CV upload" />
    </div>
  );
}

export default function PreSignupOnboarding() {
  useTranslation();
  return (
    <AuthProvider>
      <OnboardingFlow />
    </AuthProvider>
  );
}
function OnboardingFlow() {
  useTranslation();
  const navigate = useNavigate();
  const { signUp, signInWithGoogle, isAuthenticated, initialized } = useAuth();
  const [params, setParams] = useSearchParams();
  useEffect(() => { const slug = params.get("template"); if (slug) rememberOnboardingTemplate(slug); }, [params]);
  const [guest, setGuest] = useState<GuestUpload | null>(readGuestUpload);
  const [newCv, setNewCv] = useState<NewCvOnboarding | null>(readNewCvOnboarding);
  const [hydrated, setHydrated] = useState(() => !guest || !!newCv);
  const [config, setConfig] = useState<PrivacyConfig | null>(null);
  const [aiProcessing, setAiProcessing] = useState(false);
  const aiRequired = config?.ai_required !== false;
  const uploadAllowed = !!config?.collection_enabled && (!aiRequired || config.ai_enabled);
  const rawStage = params.get("step");
  const stage: Stage = guest || newCv
    ? rawStage === "upload" || rawStage === "questions" || rawStage === "signup"
      ? rawStage
      : newCv?.step ?? guest!.step
    : "upload";
  const questionParam = Number(
    params.get("question") ?? (newCv ? newCv.question + 1 : guest ? guest.question + 1 : 1),
  );
  const questionIndex = Number.isInteger(questionParam)
    ? Math.min(4, Math.max(1, questionParam)) - 1
    : 0;
  const question = PRE_SIGNUP_QUESTIONS[questionIndex];
  const [answers, setAnswers] = useState<OnboardingAnswers>(
    () => newCv?.answers ?? guest?.answers ?? {},
  );
  const [uploadError, setUploadError] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [signupEmail, setSignupEmail] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState<ProcessingPhase>("idle");
  const [failureMessage, setFailureMessage] = useState("");
  const [retryAvailable, setRetryAvailable] = useState(true);
  const [review, setReview] = useState<GuestReviewPreview | null>(null);
  const [pollKey, setPollKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const uploadingRef = useRef(false);
  const trackedProcessing = useRef("");
  const trackedView = useRef("");
  const trackedPreview = useRef("");
  const parseStart = useRef<{ id: string; at: number } | null>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const parseElapsed = parseStart.current && guest && parseStart.current.id === guest.id ? Math.max(0, now - parseStart.current.at) : 0;
  const parseSlow = processing === "parsing" && parseElapsed > PARSE_SLOW_MS;
  const guestFailed = !!guest && !newCv && processing === "failed";
  const scoredReview = guest && !newCv && processing === "ready" && review && typeof review.score === "number" ? review : null;
  // A PDF saved as an image: the next step is rebuilding it as an ATS-friendly CV.
  const imageReview = isImageBasedReview(scoredReview);

  useEffect(() => {
    if (!guest || (processing !== "ready" && processing !== "failed")) return;
    const key = `${guest.id}:${processing}`;
    if (trackedProcessing.current === key) return;
    trackedProcessing.current = key;
    trackEvent(processing === "ready" ? "pre_signup_analysis_ready" : "pre_signup_analysis_failed", {result: processing === "ready" ? "success" : "failure"});
  }, [guest?.id, processing]);

  useEffect(() => {
    let active = true;
    void getPrivacyConfig().then(value => { if (active) setConfig(value); }).catch(() => { if (active) setUploadError("Upload availability could not be checked. Please try again."); });
    const expired = () => { if (!readGuestUpload() && !readNewCvOnboarding()) { setGuest(null); setAnswers({}); setProcessing("idle"); setHydrated(true); setError(t("Your recovery window has expired. Please upload your CV again.")); } };
    window.addEventListener("cv-builder:guest-expired", expired);
    return () => { active = false; window.removeEventListener("cv-builder:guest-expired", expired); };
  }, []);
  useEffect(() => {
    if (!guest || newCv || hydrated) return;
    let active = true;
    void getGuestStatus(guest).then(value => {
      if (!active) return;
      setAnswers(value.answers); setAiProcessing(value.ai_processing);
      setGuest(previous => previous ? { ...previous, original_filename: value.original_filename, answers: value.answers } : null);
      setHydrated(true);
    }).catch(() => { if (active) setError(t("We couldn't restore your upload. Refresh to retry, or delete it and start again.")); });
    return () => { active = false; };
  }, [guest?.id, newCv, hydrated]);

  function go(next: Stage, index = 0) {
    setParams(
      next === "questions"
        ? { step: next, question: String(index + 1) }
        : { step: next },
    );
  }
  useEffect(() => {
    content.current
      ?.querySelector<HTMLElement>("h1")
      ?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
    trackEvent("pre_signup_step_view", {
      step: stage,
      question: stage === "questions" ? question.id : undefined,
    });
    const view = stage === "questions" ? `questions:${question.id}` : stage;
    if (trackedView.current === view) return;
    trackedView.current = view;
    const events: Record<Stage, FunnelEvent> = { upload: "onboarding_upload_view", questions: "onboarding_question_view", signup: "onboarding_signup_view" };
    trackFunnelEvent(events[stage], stage === "questions" ? QUESTION_FUNNEL_DETAIL[question.id] : undefined);
  }, [stage, questionIndex, question.id]);
  useEffect(() => {
    if (stage !== "signup" || !guest || newCv) return;
    const kind = processing === "ready" ? previewKind(review) ?? "unscored" : processing === "failed" ? "unscored" : null;
    if (!kind || trackedPreview.current === guest.id) return;
    trackedPreview.current = guest.id;
    trackFunnelEvent("onboarding_score_preview", kind);
  }, [stage, guest?.id, newCv, processing, review]);
  useEffect(() => () => clearTimeout(advanceTimer.current), [stage, questionIndex]);
  useEffect(() => {
    if (newCv && stage !== "upload") {
      try { saveNewCvOnboarding({ ...newCv, answers, step: stage, question: questionIndex }); }
      catch { setError(t("Allow browser storage to keep your CV through sign-up.")); }
      return;
    }
    if (!guest || !hydrated || stage === "upload") return;
    const row = { ...guest, answers, step: stage, question: questionIndex };
    try {
      saveGuestUpload(row);
    } catch {
      setError(t("Allow browser storage to keep your CV through sign-up."));
    }
    void saveGuestAnswers(row, answers).catch(() =>
      setError(
        t("We couldn't save your answers. Please try again before signing up."),
      ),
    );
  }, [guest, newCv, answers, stage, questionIndex, hydrated]);
  function applyStatus(result: GuestStatus) {
    const phase = phaseFromStatus(result.status);
    setRetryAvailable(result.retry_available);
    setReview(result.review ?? null);
    setProcessing(phase);
    if (phase === "failed") setFailureMessage(result.error_message ?? "Please try another CV.");
    return phase;
  }
  useEffect(() => {
    if (!guest || newCv) return;
    if (parseStart.current?.id !== guest.id) parseStart.current = { id: guest.id, at: Date.now() };
    const startedAt = parseStart.current.at;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let first = true;
    const poll = async () => {
      try {
        const result = await getGuestStatus(guest);
        if (cancelled) return;
        setAiProcessing(result.ai_processing);
        if (config?.ai_required !== false && !result.ai_processing) { setProcessing("idle"); return; }
        const phase = applyStatus(result);
        if (phase !== "parsing") return;
        if (Date.now() - startedAt > PARSE_GIVE_UP_MS) {
          setProcessing("failed");
          setFailureMessage(GIVE_UP_MESSAGE);
          return;
        }
        if (
          result.status === "uploaded" ||
          (result.status === "parsing" && result.can_resume)
        ) {
          void processGuestCv(guest).catch(() => {
            if (!cancelled)
              setError(
                t("Analysis was interrupted. We'll retry when the connection is restored."),
              );
          });
        }
        first = false;
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : t("Couldn't check your CV. Please try again."),
        );
        if (first) return;
      }
      if (!cancelled) timer = setTimeout(poll, 3000);
    };
    setProcessing("parsing");
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [guest, newCv, aiProcessing, config?.ai_required, pollKey]);
  useEffect(() => {
    if (processing !== "parsing") return;
    const tick = setInterval(() => setNow(Date.now()), 3000);
    return () => clearInterval(tick);
  }, [processing]);
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const tick = setTimeout(() => setResendCooldown(seconds => seconds - 1), 1000);
    return () => clearTimeout(tick);
  }, [resendCooldown]);

  async function selectFile(files: File[]) {
    setDragging(false);
    if (uploadingRef.current || busy) return;
    if (!uploadAllowed) {
      setUploadError("Uploads are currently unavailable.");
      return;
    }
    if (files.length !== 1) {
      setUploadError("Please choose one CV at a time.");
      return;
    }
    const selected = files[0];
    if (!/\.(pdf|docx)$/i.test(selected.name)) {
      setUploadError("Please choose a PDF or DOCX file.");
      return;
    }
    if (selected.size === 0 || selected.size > 20 * 1024 * 1024) {
      setUploadError("Choose a non-empty file smaller than 20 MB.");
      return;
    }
    // Choosing the file next to the AI disclosure is the affirmative consent.
    const aiConsent = !!config?.ai_enabled;
    uploadingRef.current = true;
    trackEvent("pre_signup_upload_started", {file_type: /\.pdf$/i.test(selected.name) ? "pdf" : "docx"});
    trackFunnelEvent("onboarding_upload_started");
    setUploading(true);
    setUploadError("");
    setError("");
    try {
      if (guest) { await deleteGuestUpload(guest); clearGuestUpload(); setGuest(null); }
      const row = await uploadGuestCv(selected, aiConsent);
      clearNewCvOnboarding();
      setNewCv(null);
      setHydrated(true);
      setAnswers({});
      setAiProcessing(aiConsent);
      setReview(null);
      setFailureMessage("");
      setRetryAvailable(true);
      setGuest(row);
      setEmailSent(false);
      go("questions");
      trackEvent("pre_signup_upload_completed", {
        file_type: /\.pdf$/i.test(selected.name) ? "pdf" : "docx",
      });
      trackFunnelEvent("onboarding_upload_completed");
    } catch (err) {
      trackEvent("pre_signup_upload_failed", {result: "failure"});
      trackFunnelEvent("onboarding_upload_failed");
      setUploadError(
        err instanceof Error ? err.message : "Upload failed. Please try again.",
      );
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }
  async function startNewCv() {
    if (uploading || busy) return;
    setBusy(true);
    setError("");
    try {
      const draft: NewCvOnboarding = {
        id: crypto.randomUUID(), expiresAt: Date.now() + 86_400_000,
        language: documentLocale(i18n.language) ?? "en", answers: {}, step: "questions", question: 0,
      };
      saveNewCvOnboarding(draft);
      recordNewCvStart();
      if (guest) { await deleteGuestUpload(guest); clearGuestUpload(); setGuest(null); }
      setNewCv(draft);
      setAnswers({});
      setHydrated(true);
      setProcessing("idle");
      setFailureMessage("");
      setReview(null);
      setEmailSent(false);
      setUploadError("");
      go("questions");
      trackEvent("pre_signup_path_selected", { path_selected: "manual_create" });
      trackFunnelEvent("onboarding_manual_create");
    } catch (err) {
      clearNewCvOnboarding();
      setError(err instanceof Error ? err.message : t("Couldn't continue. Please try again."));
    } finally { setBusy(false); }
  }
  function tryAnotherFile() {
    go("upload");
    fileInput.current?.click();
  }
  async function changeGuestAi(accepted: boolean) {
    if (!guest) return;
    setBusy(true); setError("");
    try {
      const result = await updateGuestPrivacy(guest, choices(accepted));
      setAiProcessing(result.ai_processing);
      setProcessing(result.status === "parsed" ? "ready" : "idle");
    } catch (err) { setError(err instanceof Error ? err.message : t("Your AI choice could not be saved. Please try again.")); }
    finally { setBusy(false); }
  }
  function advanceQuestion(skip = false) {
    clearTimeout(advanceTimer.current);
    if (skip)
      setAnswers((previous) => {
        const next = { ...previous };
        delete next[question.id];
        return next;
      });
    trackEvent("pre_signup_answer", {
      question: question.id,
      skipped: skip,
    });
    if (questionIndex < 3) go("questions", questionIndex + 1);
    else go("signup");
  }
  function chooseAnswer(value: string) {
    setAnswers((previous) => ({ ...previous, [question.id]: value }));
    clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => advanceQuestion(), AUTO_ADVANCE_MS);
  }
  async function reset() {
    if (uploading || busy) return;
    setBusy(true);
    try { if (guest) await deleteGuestUpload(guest); }
    catch { setError(t("Your upload could not be deleted. Please retry; it has not been cleared from this device.")); return; }
    finally { setBusy(false); }
    clearGuestUpload();
    clearNewCvOnboarding();
    setNewCv(null);
    setGuest(null);
    setHydrated(true);
    setAnswers({});
    setName("");
    setUploadError("");
    setError("");
    setProcessing("idle");
    setFailureMessage("");
    setReview(null);
    setEmailSent(false);
    setParams({}, { replace: true });
  }
  async function prepareAuth() {
    if (newCv) {
      saveNewCvOnboarding({ ...newCv, answers, step: "signup", question: questionIndex });
      stashPostAuthRedirect(ONBOARDING_RESUME_PATH);
      return;
    }
    if (!guest) throw new Error("Please upload your CV first.");
    const row = { ...guest, answers, step: "signup" as const };
    saveGuestUpload(row);
    await saveGuestAnswers(row, answers);
    await updateGuestPrivacy(row, choices(aiProcessing));
    stashPostAuthRedirect(ONBOARDING_RESUME_PATH);
  }
  async function submitSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email"));
    setBusy(true);
    setError("");
    try {
      await prepareAuth();
      const result = await signUp(
        name.trim(),
        email,
        String(fields.get("password")),
      );
      trackEvent("pre_signup_account_created", {
        method: "email",
        verification_required: result.needsEmailVerification,
      });
      trackFunnelEvent("signup_completed", "email");
      if (result.needsEmailVerification) {
        trackFunnelEvent("email_verification_required");
        setSignupEmail(email);
        setResent(false);
        setResendCooldown(RESEND_COOLDOWN_SECONDS);
        setEmailSent(true);
      }
      else navigate(ONBOARDING_RESUME_PATH);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Couldn't create your account. Please try again."),
      );
    } finally {
      setBusy(false);
    }
  }
  async function resendVerification() {
    if (resendCooldown > 0 || resending || !signupEmail) return;
    setResending(true);
    setError("");
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email: signupEmail,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (resendError) throw resendError;
      setResent(true);
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Failed to resend email."));
    } finally {
      setResending(false);
    }
  }
  async function continueWithAccount(google = false) {
    setBusy(true);
    setError("");
    try {
      await prepareAuth();
      if (google) await signInWithGoogle();
      else navigate(ONBOARDING_RESUME_PATH);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t("Couldn't continue. Please try again."),
      );
    } finally {
      setBusy(false);
    }
  }
  async function retryParsing() {
    if (!guest) return;
    setError("");
    setFailureMessage("");
    parseStart.current = { id: guest.id, at: Date.now() };
    setNow(Date.now());
    setProcessing("parsing");
    try {
      const result = await processGuestCv(guest);
      // Another request still holds the lease: keep polling it.
      if (applyStatus(result) === "parsing") setPollKey(key => key + 1);
    } catch (err) {
      setProcessing("failed");
      setFailureMessage(err instanceof Error ? err.message : "Please try another CV.");
    }
  }
  const failurePanel = guestFailed && (
    <AnalysisFailed
      message={failureMessage || "Please try another CV."}
      retryAvailable={retryAvailable}
      busy={busy || uploading}
      onRetry={() => void retryParsing()}
      onAnotherFile={tryAnotherFile}
      onCreateNew={() => void startNewCv()}
    />
  );
  const questionsLeft = PRE_SIGNUP_QUESTIONS.length - questionIndex;
  const answered = !!answers[question.id];
  return (
    <div className="ob-page">
      <header className="ob-header">
        <Link to={publicPath("/")} className="ob-logo">
          <img src="/images/logo.png" alt="" width={30} height={30} />
          <span>
            {"jobspecific"}<span>{t("CV")}</span>
          </span>
        </Link>
        <button
          type="button"
          className="ob-reset"
          onClick={() => void reset()}
          disabled={uploading || busy}
        >
          <RotateCcw size={14} />
          <span>{guest ? t("Delete upload & restart") : t("Restart")}</span>
        </button>
      </header>
      <input
        ref={fileInput}
        className="ob-visually-hidden"
        id="onboarding-cv-file"
        type="file"
        tabIndex={-1}
        accept=".pdf,.docx"
        aria-label={t("Choose a CV file")}
        disabled={uploading || !uploadAllowed}
        onChange={(event) => {
          void selectFile(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <main ref={content} className={`ob-main${stage === "upload" ? " ob-main-start" : ""}`}>
        <div className="ob-layout">
          {stage === "upload" && <aside className="ob-start-guidance">
            <h1 tabIndex={-1}>{t("Start with your current CV")}</h1>
            <p className="ob-description">{t("Upload your CV first, then customize it for a real job and export the finished version. This is the fastest path to seeing how jobspecificCV helps.")}</p>
            <h2>{t("First application checklist")}</h2>
            <ol className="ob-start-checklist">
              {ONBOARDING_STEPS.map(step => {
                const Icon = step.icon;
                return <li key={step.id}>
                  <span className="ob-step-icon"><Icon size={19} aria-hidden="true" /></span>
                  <div><h3>{t(step.label)}</h3><p>{t(step.description)}</p></div>
                </li>;
              })}
            </ol>
          </aside>}

          <div className="ob-content" key={`${stage}-${questionIndex}`}>
            {!hydrated && guest && !newCv && <p role="status">{t("Restoring your upload and answers…")}</p>}
            {error && (
              <p className="ob-error" role="alert">
                {t(error)}
              </p>
            )}
            {error && <SupportHelp topic="CV upload" />}
            {guest && !newCv && stage !== "upload" && hydrated && aiRequired && !aiProcessing && <>
              <h1 tabIndex={-1}>{t("Enable AI to continue")}</h1>
              <p className="ob-description">{t("Your upload is saved for your remaining recovery window. JobSpecificCV needs AI to analyze it. You can enable AI below to resume, or delete your upload and leave.")}</p>
            </>}
            {stage === "upload" && (
              <>
                {!config?.collection_enabled && <p className="ob-footnote" role="status">{config ? t("Uploads are temporarily unavailable while privacy arrangements are verified.") : t("Checking upload availability…")}</p>}
                {config?.collection_enabled && !uploadAllowed && <p className="ob-footnote" role="status">{t("AI analysis is temporarily unavailable. You can still create a new CV.")}</p>}
                <button
                  type="button"
                  disabled={uploading || busy || !uploadAllowed}
                  className={`ob-upload-zone${dragging ? " is-dragging" : ""}`}
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    void selectFile(Array.from(event.dataTransfer.files));
                  }}
                >
                  <span className="ob-upload-icon">
                    {uploading ? (
                      <Loader2 size={27} className="animate-spin" />
                    ) : (
                      <Upload size={27} />
                    )}
                  </span>
                  <strong>
                    {uploading ? t("Uploading your CV…") : t("Upload & analyze with AI")}
                  </strong>
                  <span>
                    {t("Drop your CV here or")}{" "}<b>{t("browse files on your device")}</b></span>
                  <small>{t("PDF or DOCX · up to 20 MB")}</small>
                </button>
                <AiUploadDisclosure consentOnUpload config={config} extraDetails={<p>{t("We temporarily store your CV to read it and prepare a guidance score. Recover it for 24 hours; expired uploads are removed during daily cleanup. Avoid unnecessary sensitive or third-party information.")}</p>} />
                {uploadError && (
                  <p className="ob-error" role="alert">
                    {t(uploadError)}
                  </p>
                )}
                {uploadError && <SupportHelp topic="CV upload" />}
                <div className="ob-divider"><span>{t("or")}</span></div>
                <button type="button" className="ob-create-zone" disabled={uploading || busy} onClick={() => void startNewCv()}>
                  <span className="ob-upload-icon"><FileText size={27} aria-hidden="true" /></span>
                  <strong>{t("Create a new CV")}</strong>
                  <span>{t("Start from a blank main CV if you do not have a file ready. You can still customize it for a job later.")}</span>
                  <small><CheckCircle2 size={14} aria-hidden="true" />{t("Structured editor with live preview")}</small>
                </button>
                {guest && (
                  <button
                    className="ob-primary ob-continue-file"
                    onClick={() => go("questions")}
                  >
                    {t("Continue with")}{" "}{guest.original_filename}{" "}
                    <ArrowRight size={17} />
                  </button>
                )}
              </>
            )}
            {stage === "questions" && hydrated && (newCv || !aiRequired || aiProcessing) && (
              <>
                {failurePanel}
                {guest && !newCv && (
                  <AnalysisStatus phase={processing} elapsedMs={parseElapsed} questionsLeft={questionsLeft} slow={parseSlow} onAnotherFile={tryAnotherFile} onCreateNew={() => void startNewCv()} />
                )}
                <div className="ob-question-progress">
                  <span>{t("{{current}} of {{total}} · ~{{seconds}} sec", { current: questionIndex + 1, total: PRE_SIGNUP_QUESTIONS.length, seconds: remainingSeconds(questionIndex) })}</span>
                  <button
                    type="button"
                    className="ob-text-button"
                    onClick={() => advanceQuestion(!answered)}
                  >
                    {answered ? t("Next") : t("Skip")}</button>
                </div>
                <div
                  className="ob-progress-track"
                  role="progressbar"
                  aria-label={t("Questionnaire progress")}
                  aria-valuemin={0}
                  aria-valuemax={4}
                  aria-valuenow={questionIndex + 1}
                >
                  <span
                    style={{
                      width: `${((questionIndex + 1) / PRE_SIGNUP_QUESTIONS.length) * 100}%`,
                    }}
                  />
                </div>
                <fieldset className="ob-question">
                  <legend>
                    <h1 tabIndex={-1}>{t(question.title)}</h1>
                  </legend>
                  <p className="ob-why">{t(question.why)}</p>
                  <div className={`ob-options${question.options.length > 5 ? " is-grid" : ""}`}>
                    {question.options.map(({ value, label, detail, icon: Icon }, index) => {
                      const selected = answers[question.id] === value;
                      return (
                        <button
                          type="button"
                          key={value}
                          aria-pressed={selected}
                          className={`ob-option${selected ? " is-selected" : ""}`}
                          style={{ animationDelay: `${index * 40}ms` }}
                          onClick={() => chooseAnswer(value)}
                        >
                          <span className="ob-option-icon" aria-hidden="true"><Icon size={18} /></span>
                          <span className="ob-option-copy">
                            <strong>{t(label)}</strong>
                            {detail && <small>{t(detail)}</small>}
                          </span>
                          <span className="ob-radio-mark" aria-hidden="true">
                            {selected && <Check size={12} />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
                <div className="ob-question-actions">
                  <button
                    type="button"
                    className="ob-back"
                    onClick={() =>
                      questionIndex === 0
                        ? go("upload")
                        : go("questions", questionIndex - 1)
                    }
                  >
                    <ArrowLeft size={16} /> {" "}{t("Back")}</button>
                </div>
                <p className="ob-footnote ob-question-note">{question.id === "source" ? t("Optional: helps us learn how people find us. If you've allowed analytics, your answer only counts toward totals. It's never sent to AI.") : t("Optional: your answers personalize guidance and are not verified CV facts. Skip any question; clear answers later in your profile.")}</p>
              </>
            )}
            {stage === "signup" && (newCv || !aiRequired || aiProcessing) && (
              <>
                <h1 tabIndex={-1}>
                  {emailSent
                    ? t("Check your email")
                    : scoredReview
                      ? t("Your CV scores {{score}}/100", { score: Math.round(scoredReview.score!) })
                      : guestFailed ? t("Save your progress") : t("Save your CV")}
                </h1>
                <p className="ob-description">
                  {emailSent
                    ? newCv ? t("Confirm your email to review your new CV and choose your next step. Continue on this device within 24 hours.") : scoredReview ? t("Confirm your email to save your CV and start fixing these points. Continue on this device within 24 hours of uploading.") : t("Confirm your email to save your CV and see your score. Recover this upload on this device within 24 hours of uploading.")
                    : newCv ? t("Create an account to save your new CV and choose your next step.") : scoredReview ? t("Create an account to see your full report and fix these.") : guestFailed ? t("We couldn't analyze this file, so there is nothing to save yet.") : t("Create an account to save your CV and see your score.")}
                </p>
                {failurePanel}
                {guest && !newCv && processing === "ready" && review && <ScorePreview review={review} />}
                {(newCv || (!guestFailed && !(processing === "ready" && review))) && (
                  <div className="ob-ready-strip">
                    <span className="ob-ready-icon">
                      <FileText size={19} />
                    </span>
                    <div>
                      <strong>{newCv ? t("Your new CV") : guest?.original_filename}</strong>
                      <span>
                        {Object.keys(answers).length} {" "}{t("preferences selected")}</span>
                    </div>
                    {processing === "ready" && <CheckCircle2 size={19} />}
                  </div>
                )}
                {guest && !newCv && processing === "parsing" && (
                  <AnalysisStatus phase={processing} elapsedMs={parseElapsed} slow={parseSlow} onAnotherFile={tryAnotherFile} onCreateNew={() => void startNewCv()} />
                )}
                {!guestFailed && (initialized && isAuthenticated ? (
                  <button
                    className="ob-primary"
                    disabled={busy}
                    onClick={() => void continueWithAccount()}
                  >
                    {imageReview ? t("Build an ATS-friendly CV") : scoredReview ? t("Improve my CV") : t("See my CV score")}{" "}<ArrowRight size={17} />
                  </button>
                ) : emailSent ? (
                  <div className="ob-email-sent">
                    <p><Mail size={16} aria-hidden="true" />{t("We sent a verification link to {{email}}.", { email: signupEmail })}</p>
                    <button
                      type="button"
                      className="ob-secondary"
                      disabled={resendCooldown > 0 || resending || !signupEmail}
                      onClick={() => void resendVerification()}
                    >
                      <RefreshCw size={14} className={resending ? "animate-spin" : ""} aria-hidden="true" />
                      {resending
                        ? t("Resending...")
                        : resendCooldown > 0
                          ? t("Resend email ({{seconds}}s)", { seconds: resendCooldown })
                          : t("Resend verification email")}
                    </button>
                    {resent && <p className="ob-footnote" role="status">{t("Verification email resent successfully.")}</p>}
                    <p className="ob-footnote">{t("Can't find it? Check your spam or promotions folder.")}</p>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="ob-google"
                      disabled={busy || !initialized}
                      onClick={() => void continueWithAccount(true)}
                    >
                      <svg
                        viewBox="0 0 24 24"
                        width="18"
                        height="18"
                        aria-hidden="true"
                      >
                        <path
                          fill="#4285F4"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                        />
                        <path
                          fill="#34A853"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M5.84 14.09A6.6 6.6 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93z"
                        />
                        <path
                          fill="#EA4335"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.7 10.7 0 0 0 12 1C7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        />
                      </svg>
                      {t("Continue with Google")}</button>
                    <div className="ob-divider">
                      <span>{t("or use your email")}</span>
                    </div>
                    <form className="ob-signup-form" onSubmit={submitSignup}>
                      <label htmlFor="onboarding-name">{t("Full name")}</label>
                      <input
                        id="onboarding-name"
                        name="name"
                        autoComplete="name"
                        placeholder={t("Your full name")}
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        required
                        pattern={t(".*\\S.*")}
                        disabled={busy}
                      />
                      <label htmlFor="onboarding-email">{t("Email address")}</label>
                      <input
                        id="onboarding-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        placeholder={t("you@example.com")}
                        required
                        disabled={busy}
                      />
                      <label htmlFor="onboarding-password">{t("Password")}</label>
                      <div className="ob-password">
                        <input
                          id="onboarding-password"
                          name="password"
                          type={showPassword ? "text" : "password"}
                          autoComplete="new-password"
                          placeholder={t("At least 8 characters")}
                          minLength={8}
                          required
                          disabled={busy}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((value) => !value)}
                          aria-label={
                            showPassword ? t("Hide password") : t("Show password")
                          }
                        >
                          {showPassword ? (
                            <EyeOff size={17} />
                          ) : (
                            <Eye size={17} />
                          )}
                        </button>
                      </div>
                      <button
                        type="submit"
                        className="ob-primary"
                        disabled={busy || !initialized}
                      >
                        {busy ? (
                          <Loader2 size={17} className="animate-spin" />
                        ) : (
                          <>
                            {imageReview ? t("Create account & build an ATS-friendly CV") : scoredReview ? t("Create account & improve my CV") : t("Create account & see my score")}{" "}
                            <ArrowRight size={17} />
                          </>
                        )}
                      </button>
                    </form>
                  </>
                ))}
                {!guestFailed && (
                  <p className="ob-footnote">
                    <LockKeyhole size={13} /> {" "}{newCv ? t("Your new CV will be saved to your account after sign-up.") : t("Your CV is stored temporarily now and linked to your account after sign-up.")}</p>
                )}
                <p className="ob-signin">
                  {emailSent ? t("Already verified?") : t("Already have an account?")}{" "}
                  <Link
                    to="/signin"
                    state={{ from: ONBOARDING_RESUME_PATH }}
                    onClick={() =>
                      stashPostAuthRedirect(ONBOARDING_RESUME_PATH)
                    }
                  >
                    {t("Sign in")}</Link>
                </p>
                <button
                  type="button"
                  className="ob-back"
                  onClick={() => go("questions", 3)}
                  disabled={busy}
                >
                  <ArrowLeft size={15} /> {" "}{t("Review my answers")}</button>
              </>
            )}
            {guest && !newCv && stage !== "upload" && hydrated && <div className="ob-ai-choice">
              <label><input type="checkbox" aria-label={t("AI processing for this upload")} checked={aiProcessing} disabled={busy || (!config?.ai_enabled && !aiProcessing)} onChange={event => void changeGuestAi(event.target.checked)} />{t("AI processing")}{config?.ai_provider ? ` ${t("with {{provider}}", { provider: config.ai_provider })}` : ""}</label>
              <span>{t("You can change this choice at any time.")}{" "}<Link to="/privacy">{t("Privacy notice")}</Link>{"."}</span>
            </div>}
          </div>
        </div>
      </main>
      <footer className="ob-footer">
        {newCv ? t("Create a new CV · A few questions · Create an account · CV score · Activate trial") : t("Create or upload · A few questions · Create an account · CV score · Activate trial")}</footer>
    </div>
  );
}

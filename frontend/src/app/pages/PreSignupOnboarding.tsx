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
  RotateCcw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  PRE_SIGNUP_QUESTIONS,
  type OnboardingAnswers,
} from "../onboarding/pre-signup-questions";
import { AuthProvider, useAuth } from "../integration/auth-context";
import {
  clearGuestUpload,
  getGuestStatus,
  ONBOARDING_RESUME_PATH,
  processGuestCv,
  readGuestUpload,
  saveGuestAnswers,
  saveGuestUpload,
  uploadGuestCv,
  type GuestUpload,
} from "../integration/guest-import";
import { stashPostAuthRedirect } from "../integration/post-auth-redirect";
import { trackEvent } from "../integration/analytics";
import "./pre-signup-onboarding.css";

type Stage = "upload" | "questions" | "signup";
type ProcessingPhase = "idle" | "parsing" | "ready" | "failed";
function ParsingStatus({ phase }: { phase: ProcessingPhase }) {
  if (phase === "idle") return null;
  return (
    <p className="ob-parsing-status" role="status">
      {phase === "ready" ? (
        <CheckCircle2 size={15} />
      ) : phase === "failed" ? (
        <FileText size={15} />
      ) : (
        <Loader2 size={15} className="animate-spin" />
      )}
      {phase === "ready"
        ? "CV analysis ready"
        : phase === "failed"
          ? "Your CV needs another try"
          : "Parsing and analyzing your CV…"}
    </p>
  );
}
export default function PreSignupOnboarding() {
  return (
    <AuthProvider>
      <OnboardingFlow />
    </AuthProvider>
  );
}
function OnboardingFlow() {
  const navigate = useNavigate();
  const { signUp, signInWithGoogle, isAuthenticated, initialized } = useAuth();
  const [params, setParams] = useSearchParams();
  const [guest, setGuest] = useState<GuestUpload | null>(readGuestUpload);
  const rawStage = params.get("step");
  const stage: Stage = guest
    ? rawStage === "upload" || rawStage === "questions" || rawStage === "signup"
      ? rawStage
      : guest.step
    : "upload";
  const questionParam = Number(
    params.get("question") ?? (guest ? guest.question + 1 : 1),
  );
  const questionIndex = Number.isInteger(questionParam)
    ? Math.min(4, Math.max(1, questionParam)) - 1
    : 0;
  const question = PRE_SIGNUP_QUESTIONS[questionIndex];
  const [answers, setAnswers] = useState<OnboardingAnswers>(
    () => guest?.answers ?? {},
  );
  const [uploadError, setUploadError] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [processing, setProcessing] = useState<ProcessingPhase>("idle");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const uploadingRef = useRef(false);

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
  }, [stage, questionIndex, question.id]);
  useEffect(() => {
    if (!guest || stage === "upload") return;
    const row = { ...guest, answers, step: stage, question: questionIndex };
    try {
      saveGuestUpload(row);
    } catch {
      setError("Allow browser storage to keep your CV through sign-up.");
    }
    void saveGuestAnswers(row, answers).catch(() =>
      setError(
        "We couldn't save your answers. Please try again before signing up.",
      ),
    );
  }, [guest, answers, stage, questionIndex]);
  useEffect(() => {
    if (!guest) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let first = true;
    const poll = async () => {
      try {
        const result = await getGuestStatus(guest);
        if (cancelled) return;
        setProcessing(
          result.status === "parsed"
            ? "ready"
            : result.status === "failed"
              ? "failed"
              : "parsing",
        );
        if (result.status === "failed")
          setError(result.error_message ?? "Please try another CV.");
        if (
          result.status === "uploaded" ||
          (result.status === "parsing" && result.can_resume)
        ) {
          void processGuestCv(guest).catch(() => {
            if (!cancelled)
              setError(
                "Analysis was interrupted. We'll retry when the connection is restored.",
              );
          });
        }
        first = false;
        if (result.status === "parsed" || result.status === "failed") return;
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.message
            : "Couldn't check your CV. Please try again.",
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
  }, [guest]);

  async function selectFile(files: File[]) {
    setDragging(false);
    if (uploadingRef.current) return;
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
    uploadingRef.current = true;
    setUploading(true);
    setUploadError("");
    setError("");
    try {
      const row = await uploadGuestCv(selected);
      setAnswers({});
      setGuest(row);
      setEmailSent(false);
      go("questions");
      trackEvent("pre_signup_upload_completed", {
        file_type: /\.pdf$/i.test(selected.name) ? "pdf" : "docx",
      });
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : "Upload failed. Please try again.",
      );
    } finally {
      uploadingRef.current = false;
      setUploading(false);
    }
  }
  function advanceQuestion(skip = false) {
    if (skip)
      setAnswers((previous) => {
        const next = { ...previous };
        delete next[question.id];
        return next;
      });
    trackEvent("pre_signup_answer", {
      question: question.id,
      answer: skip ? "skipped" : answers[question.id],
    });
    if (questionIndex < 3) go("questions", questionIndex + 1);
    else go("signup");
  }
  function reset() {
    if (uploading || busy) return;
    clearGuestUpload();
    setGuest(null);
    setAnswers({});
    setName("");
    setUploadError("");
    setError("");
    setProcessing("idle");
    setEmailSent(false);
    setParams({}, { replace: true });
  }
  async function prepareAuth() {
    if (!guest) throw new Error("Please upload your CV first.");
    const row = { ...guest, answers, step: "signup" as const };
    saveGuestUpload(row);
    await saveGuestAnswers(row, answers);
    stashPostAuthRedirect(ONBOARDING_RESUME_PATH);
  }
  async function submitSignup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await prepareAuth();
      const result = await signUp(
        name.trim(),
        String(fields.get("email")),
        String(fields.get("password")),
      );
      trackEvent("pre_signup_account_created", {
        method: "email",
        verification_required: result.needsEmailVerification,
      });
      if (result.needsEmailVerification) setEmailSent(true);
      else navigate(ONBOARDING_RESUME_PATH);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Couldn't create your account. Please try again.",
      );
    } finally {
      setBusy(false);
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
          : "Couldn't continue. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function retryParsing() {
    if (!guest) return;
    setError("");
    setProcessing("parsing");
    try {
      const result = await processGuestCv(guest);
      setProcessing(result.status === "parsed" ? "ready" : "failed");
      if (result.error_message) setError(result.error_message);
    } catch (err) {
      setProcessing("failed");
      setError(
        err instanceof Error ? err.message : "Please upload another CV.",
      );
    }
  }
  return (
    <div className="ob-page">
      <header className="ob-header">
        <Link to="/guided-journey" className="ob-logo">
          <img src="/images/logo.png" alt="" width={30} height={30} />
          <span>
            jobspecific<span>CV</span>
          </span>
        </Link>
        <button
          type="button"
          className="ob-reset"
          onClick={reset}
          disabled={uploading || busy}
        >
          <RotateCcw size={14} />
          <span>Restart</span>
        </button>
      </header>
      <main ref={content} className="ob-main">
        <div className="ob-layout">
          <div className="ob-content" key={`${stage}-${questionIndex}`}>
            {error && (
              <p className="ob-error" role="alert">
                {error}
              </p>
            )}
            {processing === "failed" && (
              <button className="ob-back" onClick={retryParsing}>
                Retry analysis
              </button>
            )}
            {stage === "upload" && (
              <>
                <h1 tabIndex={-1}>Upload your CV</h1>
                <p className="ob-description">
                  Start with your existing CV. No account needed.
                </p>
                <input
                  ref={fileInput}
                  className="ob-visually-hidden"
                  id="onboarding-cv-file"
                  type="file"
                  tabIndex={-1}
                  accept=".pdf,.docx"
                  aria-label="Choose a CV file"
                  disabled={uploading}
                  onChange={(event) => {
                    void selectFile(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  disabled={uploading}
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
                    {uploading ? "Uploading your CV…" : "Drop your CV here"}
                  </strong>
                  <span>
                    or <b>browse files</b> on your device
                  </span>
                  <small>PDF or DOCX · up to 20 MB</small>
                </button>
                {uploadError && (
                  <p className="ob-error" role="alert">
                    {uploadError}
                  </p>
                )}
                {guest && (
                  <button
                    className="ob-primary"
                    onClick={() => go("questions")}
                  >
                    Continue with {guest.original_filename}{" "}
                    <ArrowRight size={17} />
                  </button>
                )}
                <p className="ob-footnote">
                  <ShieldCheck size={14} /> Your upload is private. Create an
                  account to keep it.
                </p>
              </>
            )}
            {stage === "questions" && (
              <>
                <div className="ob-question-progress">
                  <span>Question {questionIndex + 1} of 4</span>
                  <button
                    type="button"
                    className="ob-text-button"
                    onClick={() => advanceQuestion(true)}
                  >
                    Skip
                  </button>
                </div>
                <div
                  className="ob-progress-track"
                  role="progressbar"
                  aria-label="Questionnaire progress"
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
                    <h1 tabIndex={-1}>{question.title}</h1>
                  </legend>
                  <p className="ob-description">{question.description}</p>
                  <div className="ob-options">
                    {question.options.map(({ value, label }, index) => (
                      <label
                        key={value}
                        className={`ob-option${answers[question.id] === value ? " is-selected" : ""}`}
                        style={{ animationDelay: `${index * 45}ms` }}
                      >
                        <input
                          type="radio"
                          name={question.id}
                          value={value}
                          checked={answers[question.id] === value}
                          onChange={() =>
                            setAnswers((previous) => ({
                              ...previous,
                              [question.id]: value,
                            }))
                          }
                        />
                        <span className="ob-option-copy">
                          <strong>{label}</strong>
                        </span>
                        <span className="ob-radio-mark" aria-hidden="true">
                          {answers[question.id] === value && (
                            <Check size={12} />
                          )}
                        </span>
                      </label>
                    ))}
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
                    <ArrowLeft size={16} /> Back
                  </button>
                  <button
                    type="button"
                    className="ob-primary"
                    disabled={!answers[question.id]}
                    onClick={() => advanceQuestion()}
                  >
                    {questionIndex === 3 ? "Finish & continue" : "Continue"}
                    <ArrowRight size={17} />
                  </button>
                </div>
                <ParsingStatus phase={processing} />
              </>
            )}
            {stage === "signup" && (
              <>
                <h1 tabIndex={-1}>
                  {emailSent ? "Check your email" : "Save your CV"}
                </h1>
                <p className="ob-description">
                  {emailSent
                    ? "Confirm your email to save your CV and see your score. Your upload and answers will be waiting on this device for 24 hours."
                    : "Create a free account to save your CV and see your score."}
                </p>
                <div className="ob-ready-strip">
                  <span className="ob-ready-icon">
                    <FileText size={19} />
                  </span>
                  <div>
                    <strong>{guest?.original_filename}</strong>
                    <span>
                      {Object.keys(answers).length} preferences selected
                    </span>
                  </div>
                  {processing === "ready" && <CheckCircle2 size={19} />}
                </div>
                {initialized && isAuthenticated ? (
                  <button
                    className="ob-primary"
                    disabled={busy}
                    onClick={() => void continueWithAccount()}
                  >
                    See my CV score <ArrowRight size={17} />
                  </button>
                ) : (
                  !emailSent && (
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
                        Continue with Google
                      </button>
                      <div className="ob-divider">
                        <span>or use your email</span>
                      </div>
                      <form className="ob-signup-form" onSubmit={submitSignup}>
                        <label htmlFor="onboarding-name">Full name</label>
                        <input
                          id="onboarding-name"
                          name="name"
                          autoComplete="name"
                          placeholder="Your full name"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          required
                          pattern={".*\\S.*"}
                          disabled={busy}
                        />
                        <label htmlFor="onboarding-email">Email address</label>
                        <input
                          id="onboarding-email"
                          name="email"
                          type="email"
                          autoComplete="email"
                          placeholder="you@example.com"
                          required
                          disabled={busy}
                        />
                        <label htmlFor="onboarding-password">Password</label>
                        <div className="ob-password">
                          <input
                            id="onboarding-password"
                            name="password"
                            type={showPassword ? "text" : "password"}
                            autoComplete="new-password"
                            placeholder="At least 8 characters"
                            minLength={8}
                            required
                            disabled={busy}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((value) => !value)}
                            aria-label={
                              showPassword ? "Hide password" : "Show password"
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
                              Create account & see my score{" "}
                              <ArrowRight size={17} />
                            </>
                          )}
                        </button>
                      </form>
                    </>
                  )
                )}
                <ParsingStatus phase={processing} />
                <p className="ob-footnote">
                  <LockKeyhole size={13} /> Your CV is only saved to your
                  account after sign-up.
                </p>
                <p className="ob-signin">
                  {emailSent ? "Already verified?" : "Already have an account?"}{" "}
                  <Link
                    to="/signin"
                    state={{ from: ONBOARDING_RESUME_PATH }}
                    onClick={() =>
                      stashPostAuthRedirect(ONBOARDING_RESUME_PATH)
                    }
                  >
                    Sign in
                  </Link>
                </p>
                <button
                  type="button"
                  className="ob-back"
                  onClick={() => go("questions", 3)}
                  disabled={busy}
                >
                  <ArrowLeft size={15} /> Review my answers
                </button>
              </>
            )}
          </div>
        </div>
      </main>
      <footer className="ob-footer">
        Upload · A few questions · Create an account · Your CV score
      </footer>
    </div>
  );
}

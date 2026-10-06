import { ApiClientError } from "../integration/api-error";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import {
  claimGuestCv,
  clearGuestUpload,
  getGuestStatus,
  processGuestCv,
  readGuestUpload,
  saveGuestAnswers,
} from "../integration/guest-import";
import { useAuth } from "../integration/auth-context";
import { trackEvent } from "../integration/analytics";

export function OnboardingResume() {
  const navigate = useNavigate();
  const { refreshMe } = useAuth();
  const [guest] = useState(readGuestUpload);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!guest) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let answersSaved = false;
    let parseRetryAttempted = false;
    const resume = async () => {
      try {
        if (!answersSaved) {
          try {
            await saveGuestAnswers(guest, guest.answers);
          } catch (err) {
            // Already claimed uploads no longer accept anonymous answer writes.
            // The authenticated claim below still verifies the owner and proof.
            if (
              !(err instanceof ApiClientError) ||
              ![404, 409].includes(err.status)
            )
              throw err;
          }
          answersSaved = true;
        }
        // Claim first so a lost response or a second tab can safely replay the
        // handoff. A claimed guest no longer exposes anonymous status.
        try {
          const claimed = await claimGuestCv(guest);
          if (cancelled) return;
          await refreshMe();
          if (cancelled) return;
          clearGuestUpload();
          trackEvent("pre_signup_cv_claimed", {
            answered_questions: Object.keys(claimed.answers).length,
          });
          navigate(
            `/app/cv-score?import=${encodeURIComponent(claimed.import_id)}&source=guest`,
            {
              replace: true,
              state: {
                importId: claimed.import_id,
                fileName: claimed.original_filename,
                moduleType: "standard",
              },
            },
          );
          return;
        } catch (err) {
          if (!(err instanceof ApiClientError) || err.status !== 409) throw err;
        }
        const status = await getGuestStatus(guest);
        if (cancelled) return;
        if (
          status.status === "failed" &&
          retry > 0 &&
          status.retry_available &&
          !parseRetryAttempted
        ) {
          parseRetryAttempted = true;
          await processGuestCv(guest);
          if (!cancelled) timer = setTimeout(resume, 500);
          return;
        }
        if (status.status === "failed")
          throw new Error(
            status.error_message ?? "Please upload your CV again.",
          );
        if (
          status.status === "uploaded" ||
          (status.status === "parsing" && status.can_resume)
        ) {
          void processGuestCv(guest).catch(() => {
            /* persisted lease is retried by polling */
          });
        }
        if (!cancelled) timer = setTimeout(resume, 3000);
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof Error
              ? err.message
              : "We couldn't save your CV. Please try again.",
          );
      }
    };
    setError(null);
    void resume();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [guest, navigate, refreshMe, retry]);

  return (
    <div className="max-w-lg mx-auto px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold mb-3">
        {!guest
          ? "Upload your CV to get started"
          : error
            ? "Let's finish saving your CV"
            : "Preparing your CV score"}
      </h1>
      {!guest ? (
        <p>
          This upload has expired or isn't available on this device.{" "}
          <Link to="/onboarding" className="underline">
            Upload your CV
          </Link>
        </p>
      ) : error ? (
        <>
          <p role="alert" className="mb-5">
            {error}
          </p>
          <button
            className="interactive-button px-5 py-3 rounded-lg bg-teal-600 text-white"
            onClick={() => setRetry((value) => value + 1)}
          >
            Try again
          </button>
          <Link to="/onboarding" className="block mt-4 underline">
            Return to your upload
          </Link>
        </>
      ) : (
        <>
          <Loader2
            size={30}
            className="animate-spin mx-auto my-6 text-teal-600"
          />
          <p role="status">
            Your account is ready. We're finishing the analysis and saving your
            CV.
          </p>
        </>
      )}
    </div>
  );
}

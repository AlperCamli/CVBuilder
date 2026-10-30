import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { ApiClientError } from "../integration/api-error";
import { useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { CV_START_PATH } from "../design-tools";
import { needsEntryOnboarding } from "../integration/entry-onboarding";
import { Loader2 } from "lucide-react";
import {
  claimGuestCv,
  clearGuestUpload,
  getGuestStatus,
  processGuestCv,
  readGuestUpload,
} from "../integration/guest-import";
import { useAuth } from "../integration/auth-context";
import { trackEvent } from "../integration/analytics";
import { saveNewCvOnboarding, readNewCvOnboarding } from "../integration/new-cv-onboarding";
import { syncBrowserChoice } from "../integration/privacy";

export function OnboardingResume() {
  useTranslation();
  const navigate = useNavigate();
  const { refreshMe, me, api } = useAuth();
  const [guest] = useState(readGuestUpload);
  const [newCv] = useState(readNewCvOnboarding);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!newCv || !me?.user.id) return;
    let cancelled = false;
    setError(null);
    if (newCv.accountId && newCv.accountId !== me.user.id) { setError(t("This CV setup belongs to another account. Please start again.")); return; }
    saveNewCvOnboarding({ ...newCv, accountId: me.user.id });
    // Sync the visitor's analytics choice first so the signup count applies their consent.
    void syncBrowserChoice().catch(() => undefined)
      .then(() => api.patchOnboardingAnswers(newCv.answers, { path: "manual_create" }))
      // The save marks onboarding complete; refresh so the entry gate lets the account through.
      .then(() => refreshMe()).then(() => {
      if (!cancelled) navigate("/app/cv-score?source=scratch", { replace: true });
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : t("We couldn't save your CV. Please try again.")); });
    return () => { cancelled = true; };
  }, [newCv, me?.user.id, api, navigate, refreshMe, retry]);
  useEffect(() => {
    if (!guest || newCv) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let parseRetryAttempted = false;
    const resume = async () => {
      try {
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
              : t("We couldn't save your CV. Please try again."),
          );
      }
    };
    setError(null);
    void resume();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [guest, newCv, navigate, refreshMe, retry]);

  // Nothing to resume on this device (a signup outside the landing flow, or verification
  // opened elsewhere): start the onboarding, or go home if it was already completed.
  if (!guest && !newCv) return <Navigate to={needsEntryOnboarding(me) ? CV_START_PATH : "/app"} replace />;

  return (
    <div className="max-w-lg mx-auto px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold mb-3">
        {error
          ? t("Let's finish saving your CV")
          : newCv ? t("Preparing your new CV") : t("Preparing your CV score")}
      </h1>
      {error ? (
        <>
          <p role="alert" className="mb-5">
            {t(error)}
          </p>
          <button
            className="interactive-button px-5 py-3 rounded-lg bg-teal-600 text-white"
            onClick={() => setRetry((value) => value + 1)}
          >
            {t("Try again")}</button>
          <Link to="/onboarding" className="block mt-4 underline">
            {newCv ? t("Return to onboarding") : t("Return to your upload")}</Link>
        </>
      ) : (
        <>
          <Loader2
            size={30}
            className="animate-spin mx-auto my-6 text-teal-600"
          />
          <p role="status">
            {newCv ? t("Your account is ready. We're creating your new CV.") : t("Your account is ready. We're finishing the analysis and saving your CV.")}</p>
        </>
      )}
    </div>
  );
}

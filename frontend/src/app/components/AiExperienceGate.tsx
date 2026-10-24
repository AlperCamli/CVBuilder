import { canOpenExistingCvWorkspace } from "../integration/subscription-flow";
import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useAuth } from "../integration/auth-context";
import {
  choices,
  getPrivacyConfig,
  notifyAiChoiceChanged,
  privacyApi,
  type Preferences,
  type PrivacyConfig,
} from "../integration/privacy";
import "./privacy.css";

export function AiExperienceGate({ children }: { children: ReactNode }) {
  useTranslation();
  const { me } = useAuth();
  const userId = me?.user.id;
  const { pathname } = useLocation();
  // Claim transfers the guest's choice. Privacy and subscription management
  // remain reachable when permission is withdrawn or the provider is paused.
  const exempt = ["/app/profile", "/app/pricing", "/app/onboarding", "/app/cv-score", "/app/checkout"].some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const [state, setState] = useState<{
    userId: string;
    config: PrivacyConfig;
    preferences: Preferences;
  } | null>(null);
  const [failure, setFailure] = useState<{
    userId: string;
    message: string;
  } | null>(null);
  const error = failure && failure.userId === userId ? failure.message : "";
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const current = state?.userId === userId ? state : null;
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let generation = 0;
    const load = () => {
      const current = ++generation;
      return Promise.all([
        getPrivacyConfig(),
        privacyApi.get<Preferences>("/me/privacy"),
      ])
        .then(([config, preferences]) => {
          if (active && current === generation) {
            setState({ userId, config, preferences });
            setFailure(null);
          }
        })
        .catch(() => {
          if (active && current === generation)
            setFailure({
              userId,
              message: t("We couldn't check your AI choice. Please try again."),
            });
        });
    };
    void load();
    const refresh = () => {
      void load();
    };
    window.addEventListener("cv-builder:ai-privacy-change", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("cv-builder:ai-privacy-change", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [userId, retry]);
  // Pending checks are invisible; confirmed denial still shows the opt-in UI.
  // Server AI guards enforce consent independently of this presentation gate.
  if (
    exempt || canOpenExistingCvWorkspace(pathname) ||
    (!current && !error) ||
    (current &&
      (current.config.ai_required === false ||
        (current.config.ai_enabled && current.preferences.ai_processing)))
  )
    return <>{children}</>;

  async function enable() {
    if (!userId) return;
    setBusy(true);
    setFailure(null);
    try {
      const preferences = await privacyApi.patch<Preferences>(
        "/me/privacy",
        choices(true),
      );
      setState((previous) =>
        previous?.userId === userId ? { ...previous, preferences } : previous,
      );
      notifyAiChoiceChanged();
    } catch (err) {
      setFailure({
        userId,
        message: err instanceof Error ? err.message : t("Please try again."),
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="privacy-document" aria-labelledby="ai-resume-heading">
      <h1 id="ai-resume-heading">{t("Enable AI to continue")}</h1>
      <p>
        {t(
          "JobSpecificCV uses AI to analyze and improve your CV. Relevant CV text, task instructions and applicable guidance are sent to",
        )}{" "}
        {current?.config.ai_provider ?? "the configured AI provider"}
        {"."}
      </p>
      <p>
        {t(
          "You can enable it now, even if you declined earlier. You can withdraw permission again in your privacy settings.",
        )}
      </p>
      {current && !current.config.ai_enabled && (
        <p role="status">
          {t(
            "AI processing is temporarily unavailable. You can still manage your privacy choices, download your data or delete your account.",
          )}
        </p>
      )}
      {error && <p role="alert">{t(error)}</p>}
      <div className="privacy-actions">
        <button
          type="button"
          disabled={busy || !current?.config.ai_enabled}
          onClick={() => void enable()}
        >
          {t("Enable AI & continue")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRetry((value) => value + 1)}
        >
          {t("Check again")}
        </button>
        <Link to="/app/profile">{t("Privacy & account settings")}</Link>
        <Link to="/privacy">{t("Privacy notice")}</Link>
      </div>
    </section>
  );
}

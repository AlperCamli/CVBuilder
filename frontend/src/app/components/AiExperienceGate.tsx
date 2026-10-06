import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router";
import { useAuth } from "../integration/auth-context";
import { choices, getPrivacyConfig, notifyAiChoiceChanged, privacyApi, type Preferences, type PrivacyConfig } from "../integration/privacy";
import "./privacy.css";

export function AiExperienceGate({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const userId = me?.user.id;
  const { pathname } = useLocation();
  // Claim transfers the guest's choice. Privacy and subscription management
  // remain reachable when permission is withdrawn or the provider is paused.
  const exempt = ["/app/profile", "/app/pricing", "/app/onboarding"].some(path => pathname === path || pathname.startsWith(`${path}/`));
  const [state, setState] = useState<{ config: PrivacyConfig; preferences: Preferences } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (exempt || !userId) return;
    let active = true;
    const load = () => Promise.all([getPrivacyConfig(), privacyApi.get<Preferences>("/me/privacy")]).then(([config, preferences]) => {
      if (active) { setState({ config, preferences }); setError(""); }
    }).catch(() => { if (active) { setState(null); setError("We couldn't check your AI choice. Please try again."); } });
    setState(null);
    void load();
    const refresh = () => { void load(); };
    window.addEventListener("cv-builder:ai-privacy-change", refresh);
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("cv-builder:ai-privacy-change", refresh); window.removeEventListener("focus", refresh); };
  }, [exempt, userId, retry]);
  if (exempt || (state && (state.config.ai_required === false || (state.config.ai_enabled && state.preferences.ai_processing)))) return <>{children}</>;

  async function enable() {
    setBusy(true); setError("");
    try {
      const preferences = await privacyApi.patch<Preferences>("/me/privacy", choices(true));
      setState(previous => previous ? { ...previous, preferences } : null);
      notifyAiChoiceChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="privacy-document" aria-labelledby="ai-resume-heading">
    <h1 id="ai-resume-heading">{!state && !error ? "Checking your AI choice…" : "Enable AI to continue"}</h1>
    <p>JobSpecificCV uses AI to analyze and improve your CV. Relevant CV text, task instructions and applicable guidance are sent to {state?.config.ai_provider ?? "the configured AI provider"}.</p>
    <p>You can enable it now, even if you declined earlier. You can withdraw permission again in your privacy settings.</p>
    {state && !state.config.ai_enabled && <p role="status">AI processing is temporarily unavailable. You can still manage your privacy choices, download your data or delete your account.</p>}
    {error && <p role="alert">{error}</p>}
    <div className="privacy-actions">
      <button type="button" disabled={busy || !state?.config.ai_enabled} onClick={() => void enable()}>Enable AI & continue</button>
      <button type="button" disabled={busy} onClick={() => setRetry(value => value + 1)}>Check again</button>
      <Link to="/app/profile">Privacy & account settings</Link>
      <Link to="/privacy">Privacy notice</Link>
    </div>
  </section>;
}

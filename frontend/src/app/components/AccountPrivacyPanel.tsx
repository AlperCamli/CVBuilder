import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useAuth } from "../integration/auth-context";
import { getPrivacyConfig, choices, notifyAiChoiceChanged, openPrivacyChoices, privacyApi, saveAnalyticsChoice, type Preferences, type PrivacyConfig } from "../integration/privacy";
import { removeAnalyticsData } from "../integration/analytics";
import { clearGuestUpload } from "../integration/guest-import";
import { consumePostAuthRedirect, stashPostAuthRedirect } from "../integration/post-auth-redirect";
import { supabase } from "../integration/supabase-client";
import "./privacy.css";

type ExportJob = { id: string; status: string; expires_at: string };
export function AccountPrivacyPanel() {
  const { me, signIn, signOut } = useAuth();
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const [config, setConfig] = useState<PrivacyConfig | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [error, setError] = useState(""); const [job, setJob] = useState<ExportJob | null>(null);
  const [deleting, setDeleting] = useState(false); const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([privacyApi.get<Preferences>("/me/privacy"), getPrivacyConfig()]).then(([prefs, settings]) => { if (active) { setPreferences(prefs); setConfig(settings); } }).catch(() => { if (active) setError("Privacy settings could not be loaded. Please refresh to retry."); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!job || job.status === "complete") return;
    let active = true; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const result = await privacyApi.get<ExportJob>(`/me/privacy/exports/${job.id}`); if (!active) return; setJob(result); if (result.status !== "complete") timer = setTimeout(poll, 5000); }
      catch { if (active) setError("Your export is still pending or expired. Refresh to check again."); }
    };
    timer = setTimeout(poll, 2000);
    return () => { active = false; clearTimeout(timer); };
  }, [job?.id, job?.status]);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : "Please try again."); }
    finally { setBusy(false); }
  }
  const changeAi = (accepted: boolean) => run(async () => {
    const updated = await privacyApi.patch<Preferences>("/me/privacy", choices(accepted)); setPreferences(updated); notifyAiChoiceChanged();
    setMessage(accepted ? "AI processing enabled. You can continue using JobSpecificCV." : "AI processing disabled. AI-dependent features are paused until you enable it again. New external AI calls are blocked; already transmitted information cannot automatically be recalled.");
  });
  async function reauthenticateGoogle() {
    stashPostAuthRedirect("/app/profile");
    const result = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback`, queryParams: { prompt: "select_account" } } });
    if (result.error) throw result.error;
  }
  async function deleteAccount() {
    if (password) { await signIn(me!.user.email, password); setPassword(""); }
    await privacyApi.post("/me/privacy/deletion", { confirmation });
    try { consumePostAuthRedirect(); saveAnalyticsChoice(false, { notify: false }); } catch { /* Browser storage may be unavailable. */ }
    clearGuestUpload(); removeAnalyticsData();
    // Sign-out unmounts the protected route. A full navigation also clears its
    // in-memory CV state and cannot lose a race to the authentication guard.
    try { await signOut(); }
    finally { window.location.replace("/guided-journey?deletion=requested"); }
  }
  return <section className="privacy-panel" aria-labelledby="account-privacy-heading">
    <h2 id="account-privacy-heading">Privacy & your data</h2>
    <p><Link to="/privacy" className="underline">Privacy notice</Link> · <Link to="/cookies" className="underline">Cookies & storage</Link></p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <label><input type="checkbox" checked={preferences?.ai_processing ?? false} disabled={busy || !preferences || (!config?.ai_enabled && !preferences.ai_processing)} onChange={event => void changeAi(event.target.checked)} />Use external AI processing {config?.ai_provider ? `with ${config.ai_provider}` : ""}</label>
    <p>Relevant CV text and task instructions may be sent to this provider. {config?.ai_required !== false ? "JobSpecificCV requires AI processing for its CV-building experience. You can turn it off and enable it again here at any time. Privacy settings, data download and deletion stay available while it is off." : "You can use basic parsing, your guidance score and manual editing without AI."}</p>
    <div className="privacy-actions">
      <button type="button" onClick={openPrivacyChoices}>Analytics choices</button>
      <button type="button" disabled={busy} onClick={() => void run(async () => { await privacyApi.patch("/me/onboarding-answers", {}); setMessage("Your onboarding answers have been cleared."); })}>Clear onboarding answers</button>
      <button type="button" disabled={busy || (!!job && job.status !== "complete")} onClick={() => void run(async () => { const result = await privacyApi.post<ExportJob>("/me/privacy/exports", {}); setJob(result); setMessage("Your data export has been requested. Its archive expires after 24 hours."); })}>Download my data</button>
    </div>
    {job && <p role="status">{job.status === "complete" ? "Your export is ready." : "Preparing your data export. It may require a retry during daily maintenance."}</p>}
    {job?.status === "complete" && <div className="privacy-actions"><button type="button" onClick={() => void run(async () => { const result = await privacyApi.get<{ url: string }>(`/me/privacy/exports/${job.id}/download`); const link = document.createElement("a"); link.href = result.url; link.rel = "noopener"; link.click(); })}>Download ZIP</button></div>}
    <p>{config?.contact ? <>For other rights requests or lost account access, contact <a className="underline" href={`mailto:${config.contact}`}>{config.contact}</a>.</> : "A verified privacy contact will appear here when the operator's review is complete."}</p>
    <div className="privacy-actions"><button className="privacy-danger" type="button" disabled={busy} aria-expanded={deleting} onClick={() => setDeleting(!deleting)}>Delete account</button></div>
    {deleting && <div>
      <p>Deletion blocks account access, cancels recurring subscriptions and removes your CVs, files and account. Failed removal steps remain pending and retry. Legally required financial records may remain separately.</p>
      <p>Sign in again with your password or Google, then confirm within five minutes. After returning from Google, open this panel again.</p>
      <label htmlFor="privacy-reauth-password">Password (for password accounts)</label>
      <input id="privacy-reauth-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" />
      <div className="privacy-actions"><button disabled={busy} type="button" onClick={() => void run(reauthenticateGoogle)}>Sign in again with Google</button></div>
      <label htmlFor="privacy-delete-confirmation">Type DELETE to confirm</label>
      <input id="privacy-delete-confirmation" type="text" value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" />
      <div className="privacy-actions"><button className="privacy-danger" disabled={busy || confirmation !== "DELETE"} type="button" onClick={() => void run(deleteAccount)}>Confirm account deletion</button></div>
    </div>}
  </section>;
}

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ACCOUNT_READY_EVENT, consentSyncPending, PRIVACY_EVENT, hasGlobalPrivacyControl, getPrivacyConfig, markBrowserChoicePending, openPrivacyChoices, readAnalyticsChoice, saveAnalyticsChoice, syncBrowserChoice } from "../integration/privacy";
import { removeAnalyticsData } from "../integration/analytics";
import "./privacy.css";

export function PrivacyLinks() {
  return <nav aria-label="Privacy links" className="privacy-links"><Link to="/privacy">Privacy notice</Link><Link to="/cookies">Cookies & storage</Link><button type="button" onClick={openPrivacyChoices}>Privacy choices</button></nav>;
}
export function PrivacyControls() {
  const [analyticsAvailable, setAnalyticsAvailable] = useState(false);
  const [configLoading, setConfigLoading] = useState(true);
  const [configFailed, setConfigFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [error, setError] = useState("");
  const [syncPending, setSyncPending] = useState(false);
  const syncing = useRef(false);
  const resyncRequested = useRef(false);
  const finishSync = () => {
    syncing.current = false;
    if (resyncRequested.current) {
      resyncRequested.current = false;
      window.dispatchEvent(new Event(ACCOUNT_READY_EVENT));
    }
  };
  useEffect(() => {
    setOpen(readAnalyticsChoice() === null);
    let active = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      setConfigLoading(true);
      void getPrivacyConfig().then(config => {
        if (active && current === request) { setAnalyticsAvailable(config.analytics_enabled); setConfigFailed(false); }
      }).catch(() => {
        if (active && current === request) { setAnalyticsAvailable(false); setConfigFailed(true); }
      }).finally(() => { if (active && current === request) setConfigLoading(false); });
    };
    refresh();
    const show = () => { setOpen(true); setDetails(true); refresh(); };
    const changed = () => { if (readAnalyticsChoice() === null) setOpen(true); };
    window.addEventListener("cv-builder:open-privacy", show);
    window.addEventListener(PRIVACY_EVENT, changed);
    window.addEventListener("storage", changed);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => { active = false; window.removeEventListener("cv-builder:open-privacy", show); window.removeEventListener(PRIVACY_EVENT, changed); window.removeEventListener("storage", changed); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); };
  }, []);
  async function choose(accepted: boolean) {
    setError("");
    try {
      // Persist denial immediately, before any network operation. Defer the reload
      // event until the backend receipt has been attempted.
      const analytics = accepted && !hasGlobalPrivacyControl();
      const reloadAfterWithdrawal = !analytics && !!document.getElementById("ga4-google-tag");
      const snapshot = saveAnalyticsChoice(analytics, { notify: false, pending: true })!;
      if (!analytics) removeAnalyticsData();
      setSyncPending(true);
      syncing.current = true;
      let pending = false;
      try { await syncBrowserChoice(); }
      catch { pending = true; setError("Your browser choice is saved. Account/upload synchronization will retry when the connection returns."); }
      if (saveAnalyticsChoice(analytics, { pending, expectedSnapshot: snapshot }) === null) {
        markBrowserChoicePending();
        window.dispatchEvent(new Event(PRIVACY_EVENT));
      }
      setOpen(false);
      if (reloadAfterWithdrawal) window.location.reload();
    } catch { setError("Browser storage is unavailable. Analytics stays disabled."); }
    finally { finishSync(); setSyncPending(false); }
  }
  useEffect(() => {
    let active = true;
    const retry = (force = false) => {
      const choice = readAnalyticsChoice();
      if (choice === null || syncing.current || (!force && !consentSyncPending())) return;
      syncing.current = true;
      let snapshot: string | null;
      try { snapshot = markBrowserChoicePending(); }
      catch { syncing.current = false; return; }
      void syncBrowserChoice().then(synced => {
        if (synced === readAnalyticsChoice() && snapshot) {
          if (saveAnalyticsChoice(synced === true, {notify: false, expectedSnapshot: snapshot}) === null) markBrowserChoicePending();
        } else markBrowserChoicePending();
        if (active) setError("");
      }).catch(() => { if (active) setError("Your browser choice is saved; synchronization is pending."); }).finally(finishSync);
    };
    const online = () => retry();
    const accountReady = () => {
      if (syncing.current) resyncRequested.current = true;
      else retry(true);
    };
    retry();
    const timer = window.setInterval(online, 30_000);
    window.addEventListener("online", online);
    window.addEventListener(ACCOUNT_READY_EVENT, accountReady);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("online", online); window.removeEventListener(ACCOUNT_READY_EVENT, accountReady); };
  }, []);
  return <>
    <PrivacyLinks />
    {open && <aside className="privacy-banner" aria-label="Analytics choices">
      <p><strong>Your privacy choices</strong></p>
      <p>Essential storage keeps your upload and sign-in working. Optional analytics helps us improve JobSpecificCV.</p>
      {details && <p>Analytics is off until you accept. No advertising tracking. Change your choice here at any time. <Link to="/cookies">See storage details</Link>.</p>}
      {configLoading ? <p role="status">Checking privacy settings…</p> : configFailed ? <p role="status">Privacy settings could not be loaded. Reopen Privacy choices to try again.</p> : !analyticsAvailable && <p>Optional analytics is currently unavailable.</p>}
      <p>You can accept or reject analytics, then change your mind using “Privacy choices” at any time. Analytics is not required to use the app.</p>
      {hasGlobalPrivacyControl() && <p>Global Privacy Control is enabled. Optional analytics remains off.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="privacy-actions">
        <button type="button" disabled={syncPending || configLoading || !analyticsAvailable || hasGlobalPrivacyControl()} onClick={() => void choose(true)}>Accept analytics</button>
        <button type="button" disabled={syncPending} onClick={() => void choose(false)}>Reject analytics</button>
        <button type="button" onClick={() => setDetails(!details)} aria-expanded={details}>Settings</button>
      </div>
    </aside>}
  </>;
}

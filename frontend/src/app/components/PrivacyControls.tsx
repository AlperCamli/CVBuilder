import { publicPath, translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { ACCOUNT_READY_EVENT, consentSyncPending, PRIVACY_EVENT, hasGlobalPrivacyControl, getPrivacyConfig, markBrowserChoicePending, openPrivacyChoices, readAnalyticsChoice, saveAnalyticsChoice, syncBrowserChoice } from "../integration/privacy";
import { removeAnalyticsData } from "../integration/analytics";
import { advertisingAllowed, advertisingTagLoaded, forgetAdvertisingChoice, readAdvertisingChoice, saveAdvertisingChoice } from "../integration/advertising";
import "./privacy.css";

// Pages that render the CV editor fill the viewport and scroll inside their panes, so they show no links.
export const isEditorRoute = (pathname: string) => /^\/app\/(cv\/[^/]+|medical|tailor\/[^/]+)\/?$/.test(pathname);
// App shell pages scroll inside <main>, which shows the links at the end of the page.
export const isAppShellRoute = (pathname: string) => /^\/app(\/|$)/.test(pathname);

export function PrivacyLinks() {
  useTranslation();
  return <nav aria-label={t("Support and privacy links")} className="privacy-links"><Link to={publicPath("/support")}>{t("Support")}</Link><Link to="/privacy">{t("Privacy notice")}</Link><Link to="/cookies">{t("Cookies & storage")}</Link><button type="button" onClick={openPrivacyChoices}>{t("Cookie settings")}</button></nav>;
}
// `showLinks` is off on full-height app pages (the CV editor) whose panes scroll internally;
// the consent banner still renders there.
export function PrivacyControls({ showLinks = true }: { showLinks?: boolean } = {}) {
  useTranslation();
  const [analyticsAvailable, setAnalyticsAvailable] = useState(false);
  // Google Ads measurement is a separate choice, offered only while the operator enables it.
  const [advertisingAvailable, setAdvertisingAvailable] = useState(false);
  const advertisingOffered = useRef(false);
  const [analyticsChecked, setAnalyticsChecked] = useState(false);
  const [advertisingChecked, setAdvertisingChecked] = useState(false);
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
  const needsChoice = () => readAnalyticsChoice() === null || (advertisingOffered.current && readAdvertisingChoice() === null);
  useEffect(() => {
    if (!open) return;
    setAnalyticsChecked(readAnalyticsChoice() === true);
    setAdvertisingChecked(advertisingAllowed());
  }, [open]);
  useEffect(() => {
    setOpen(needsChoice());
    let active = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      setConfigLoading(true);
      void getPrivacyConfig().then(config => {
        if (active && current === request) {
          setAnalyticsAvailable(config.analytics_enabled); setConfigFailed(false);
          advertisingOffered.current = config.advertising_enabled === true;
          setAdvertisingAvailable(advertisingOffered.current);
          if (!advertisingOffered.current && advertisingAllowed()) {
            const loaded = advertisingTagLoaded();
            forgetAdvertisingChoice();
            if (loaded) window.location.reload();
          }
          if (needsChoice()) setOpen(true);
        }
      }).catch(() => {
        if (active && current === request) { setAnalyticsAvailable(false); advertisingOffered.current = false; setAdvertisingAvailable(false); setConfigFailed(true); }
      }).finally(() => { if (active && current === request) setConfigLoading(false); });
    };
    refresh();
    const show = () => { setOpen(true); setDetails(true); refresh(); };
    const changed = () => { if (needsChoice()) setOpen(true); };
    window.addEventListener("cv-builder:open-privacy", show);
    window.addEventListener(PRIVACY_EVENT, changed);
    window.addEventListener("storage", changed);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => { active = false; window.removeEventListener("cv-builder:open-privacy", show); window.removeEventListener(PRIVACY_EVENT, changed); window.removeEventListener("storage", changed); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); };
  }, []);
  // `advertising` is undefined while ad measurement isn't offered, which leaves that choice untouched.
  async function choose(accepted: boolean, advertising?: boolean) {
    setError("");
    try {
      const reloadAfterAdWithdrawal = advertising === false && advertisingTagLoaded();
      if (advertising !== undefined) saveAdvertisingChoice(advertising);
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
      catch { pending = true; setError(t("Your browser choice is saved. Account/upload synchronization will retry when the connection returns.")); }
      if (saveAnalyticsChoice(analytics, { pending, expectedSnapshot: snapshot }) === null) {
        markBrowserChoicePending();
        window.dispatchEvent(new Event(PRIVACY_EVENT));
      }
      setOpen(false);
      if (reloadAfterWithdrawal || reloadAfterAdWithdrawal) window.location.reload();
    } catch { setError(t("Your browser couldn’t save this choice. Optional cookies stay off.")); }
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
      }).catch(() => { if (active) setError(t("Your browser choice is saved; synchronization is pending.")); }).finally(finishSync);
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
    {showLinks && <PrivacyLinks />}
    {open && <aside className="privacy-banner" aria-label={t("Cookie preferences")}>
      <p><strong>{t("Help us improve jobspecificCV")}</strong></p>
      {advertisingAvailable ? <>
        <p>{t("Essential cookies keep you signed in and your uploads working. With your OK, we'd also like to use two small, optional tools that help us make jobspecificCV better.")}</p>
        <div className="privacy-choices">
          <label><input type="checkbox" checked={analyticsChecked} disabled={syncPending || configLoading || !analyticsAvailable || hasGlobalPrivacyControl()} onChange={event => setAnalyticsChecked(event.target.checked)} />
            <span>{t("Usage statistics")}<small>{t("Shows which pages and features help people most, so we know what to improve.")}{" · Google Analytics"}</small></span></label>
          <label><input type="checkbox" checked={advertisingChecked} disabled={syncPending || hasGlobalPrivacyControl()} onChange={event => setAdvertisingChecked(event.target.checked)} />
            <span>{t("Ad measurement")}<small>{t("Tells us whether our ads bring in people who start a free trial, so we stop paying for ads that don't work.")}{" · Google Ads"}</small></span></label>
        </div>
        <p>{t("Your CV, answers and account details are never sent to these tools, and we never show you personalized ads. Saying no changes nothing in the app, and you can change your mind anytime in Cookie settings.")}</p>
      </> : <>
        <p>{t("Essential cookies keep sign-in and uploads working. With your OK, we also use Google Analytics to see which pages and features help people most, so we can make the app better for you.")}</p>
        <p>{t("Your CV content is never included, and nothing is used for ads. It's completely optional: the app works the same either way, and you can change your choice anytime in Cookie settings.")}</p>
      </>}
      {details && <p id="cookie-usage-details">{advertisingAvailable
        ? t("Neither tool loads before you agree. Usage statistics may use Google's _ga cookies, and ad measurement may use Google's _gcl cookies.")
        : t("Analytics loads only after you agree and may use Google's _ga cookies to measure visits.")}{" "}<Link to="/cookies">{t("Read about cookies and storage")}</Link>{"."}</p>}
      {configLoading ? <p role="status">{t("Loading cookie settings…")}</p> : configFailed ? <p role="status">{t("Cookie settings couldn’t load. Optional cookies stay off. Reopen Cookie settings to try again.")}</p> : !analyticsAvailable && <p>{t("Optional cookies are currently unavailable. Essential cookies still work.")}</p>}
      {hasGlobalPrivacyControl() && <p>{t("Your browser asks us not to track usage (Global Privacy Control). Optional cookies stay off.")}</p>}
      {error && <p role="alert">{t(error)}</p>}
      <div className="privacy-actions">
        {advertisingAvailable ? <>
          <button type="button" disabled={syncPending || configLoading || hasGlobalPrivacyControl()} onClick={() => void choose(analyticsAvailable, true)}>{t("Allow all")}</button>
          <button type="button" disabled={syncPending || configLoading} onClick={() => void choose(analyticsChecked && analyticsAvailable, advertisingChecked)}>{t("Save my choices")}</button>
        </> : <button type="button" disabled={syncPending || configLoading || !analyticsAvailable || hasGlobalPrivacyControl()} onClick={() => void choose(true)}>{t("Allow analytics")}</button>}
        <button type="button" disabled={syncPending} onClick={() => void choose(false, advertisingAvailable ? false : undefined)}>{t("Essential cookies only")}</button>
        <button type="button" className="privacy-details-toggle" onClick={() => setDetails(!details)} aria-expanded={details} aria-controls={details ? "cookie-usage-details" : undefined}>{details ? t("Less detail") : t("Learn more")}</button>
      </div>
    </aside>}
  </>;
}

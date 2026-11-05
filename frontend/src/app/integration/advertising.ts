// Google Ads measurement through Google Tag Manager (GTM-PGVDXFTR). The tag itself is
// loaded by the inline loader at the top of index.html, and only after the visitor
// allows ad measurement; this module owns that choice and the trial conversion.
// AD_CHOICE_KEY, AD_NOTICE_VERSION and GTM_SCRIPT_ID must match the loader.
export const AD_CHOICE_KEY = "cv-builder:ad-choices";
export const AD_NOTICE_VERSION = "2026-11-05.1";
export const AD_PRIVACY_EVENT = "cv-builder:ad-privacy-change";
export const GTM_SCRIPT_ID = "gtm-google-tag";
const TRIAL_STARTED_PREFIX = "cv-builder:ads-trial-started:";
const AD_COOKIE_RE = /^(_gcl_|_gac_)/;

const hasWindow = (): boolean => typeof window !== "undefined";
const globalPrivacyControl = (): boolean =>
  hasWindow() && (window.navigator as Navigator & { globalPrivacyControl?: boolean } | undefined)?.globalPrivacyControl === true;

export function readAdvertisingChoice(): boolean | null {
  if (globalPrivacyControl()) return false;
  if (!hasWindow()) return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(AD_CHOICE_KEY) ?? "null");
    if (value?.version === AD_NOTICE_VERSION && typeof value.advertising === "boolean" && Date.parse(value.expires_at) > Date.now()) return value.advertising;
  } catch { /* unknown is denied */ }
  return null;
}
export const advertisingAllowed = () => readAdvertisingChoice() === true;
export const advertisingTagLoaded = () => hasWindow() && typeof document !== "undefined" && !!document.getElementById(GTM_SCRIPT_ID);

/** The Google consent-mode state for ads; remarketing (ad_personalization) is never granted. */
export function adConsentState(): Record<"ad_storage" | "ad_user_data" | "ad_personalization", "granted" | "denied"> {
  const granted = advertisingAllowed() ? "granted" : "denied";
  return { ad_storage: granted, ad_user_data: granted, ad_personalization: "denied" };
}

// Granting notifies the loader, which adds the tag. Withdrawal clears ad cookies; a tag
// already on the page cannot be unloaded, so the caller reloads when one was active.
export function saveAdvertisingChoice(accepted: boolean) {
  const advertising = accepted && !globalPrivacyControl();
  window.localStorage.setItem(AD_CHOICE_KEY, JSON.stringify({ version: AD_NOTICE_VERSION, advertising, expires_at: new Date(Date.now() + 180 * 86_400_000).toISOString() }));
  if (!advertising) clearAdvertisingCookies();
  window.dispatchEvent(new Event(AD_PRIVACY_EVENT));
  return advertising;
}

/** Forgets the choice (so the banner asks again) when the operator turns ad measurement off. */
export function forgetAdvertisingChoice() {
  try { window.localStorage.removeItem(AD_CHOICE_KEY); } catch { /* the tag still needs a stored yes to load */ }
  clearAdvertisingCookies();
}

function clearAdvertisingCookies() {
  const hostname = window.location.hostname.split(".");
  const domains = ["", ...hostname.map((_, index) => "." + hostname.slice(index).join("."))];
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0].trim();
    if (!AD_COOKIE_RE.test(name)) continue;
    for (const domain of domains) document.cookie = `${name}=; Max-Age=0; path=/${domain ? "; domain=" + domain : ""}`;
  }
}

// A withdrawal in another tab reloads this one, so the tag stops here too.
export function installAdvertisingConsentListener() {
  if (!hasWindow()) return;
  window.addEventListener("storage", event => {
    if ((event.key === AD_CHOICE_KEY || event.key === null) && advertisingTagLoaded() && !advertisingAllowed()) window.location.reload();
  });
}

/** The verified free-trial return from Stripe, sent to GTM once per Checkout Session. */
export function trackTrialStarted(checkoutSessionId: string): void {
  if (!advertisingAllowed() || !advertisingTagLoaded()) return;
  const key = TRIAL_STARTED_PREFIX + checkoutSessionId;
  try {
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, "1");
  } catch { return; /* Without storage a refresh could count the trial twice. */ }
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event: "trial_started", transaction_id: checkoutSessionId });
}

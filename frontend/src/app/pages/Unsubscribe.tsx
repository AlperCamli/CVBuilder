import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router";
import { ArrowRight, Loader2 } from "lucide-react";
import { CheckoutShell } from "../components/CheckoutScreen";
import { unsubscribeFromMarketing, unsubscribeTokenFromSearch } from "../integration/marketing-email";
import { publicPath, translate as t } from "../localization/i18n";

export type UnsubscribePhase = "missing" | "working" | "done" | "failed";

/** The page for each phase; exported for its tests. */
export function UnsubscribeView({ phase, onRetry }: { phase: UnsubscribePhase; onRetry: () => void }) {
  useTranslation();
  const home = <Link className="checkout-screen-secondary" to={publicPath("/")}>{t("Go to jobspecificCV")}</Link>;
  const footer = <footer className="checkout-screen-footer checkout-screen-footer-center">
    <p>{t("Need help?")}{" "}<Link className="underline" to={publicPath("/support")}>{t("Contact support")}</Link></p>
  </footer>;
  if (phase === "missing") return <CheckoutShell mascot="thinking" eyebrow={t("EMAIL PREFERENCES")}
    title={t("This unsubscribe link is incomplete")}
    lead={t("Open the link from the email again. If it still doesn’t work, contact support and we’ll stop the emails for you.")} footer={footer}>
    {home}
  </CheckoutShell>;
  if (phase === "failed") return <CheckoutShell mascot="thinking" eyebrow={t("EMAIL PREFERENCES")}
    title={t("We couldn’t update your email preferences")} lead={t("Something went wrong on our side. Please try again in a moment.")} footer={footer}>
    <p role="alert" className="checkout-screen-error">{t("Your unsubscribe request didn’t go through.")}</p>
    <button className="checkout-screen-primary" type="button" onClick={onRetry}>{t("Try again")}<ArrowRight size={16} aria-hidden="true" /></button>
    {home}
  </CheckoutShell>;
  if (phase === "working") return <CheckoutShell mascot="guide" eyebrow={t("EMAIL PREFERENCES")}
    title={t("Unsubscribing you…")} lead={t("This only takes a moment.")}>
    <p role="status" className="checkout-screen-waiting"><Loader2 className="animate-spin" size={16} aria-hidden="true" />{t("Updating your preferences…")}</p>
  </CheckoutShell>;
  return <CheckoutShell mascot="point" eyebrow={t("EMAIL PREFERENCES")} title={t("You’re unsubscribed")}
    lead={t("We won’t send you offers or other marketing emails anymore. You’ll still get emails about your account, like sign-in links and payment receipts.")} footer={footer}>
    <p role="status" className="checkout-screen-terms checkout-screen-terms-center">{t("Unsubscribed by mistake? Contact support.")}</p>
    {home}
  </CheckoutShell>;
}

/** /unsubscribe?t= and /tr/unsubscribe?t=: works signed out, unsubscribes on open. */
export default function Unsubscribe() {
  useTranslation();
  const { search } = useLocation();
  const token = unsubscribeTokenFromSearch(search);
  const [phase, setPhase] = useState<UnsubscribePhase>(token ? "working" : "missing");
  const sent = useRef<string | null>(null);
  const run = useCallback(async (value: string) => {
    setPhase("working");
    try { await unsubscribeFromMarketing(value); setPhase("done"); }
    catch { setPhase("failed"); }
  }, []);
  useEffect(() => {
    if (!token) { setPhase("missing"); return; }
    // Once per token, also under StrictMode's repeated effects.
    if (sent.current === token) return;
    sent.current = token;
    void run(token);
  }, [token, run]);
  return <main className="min-h-screen"><UnsubscribeView phase={phase} onRetry={() => token && void run(token)} /></main>;
}

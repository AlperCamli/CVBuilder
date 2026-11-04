import { useNavigate } from "react-router";
import { checkoutPath, hasBillingIssue, ONBOARDING_ENTRY_PATH } from "../integration/subscription-flow";
import { chooseLocale } from "../localization/i18n";
import { localeCode } from "../localization/i18n";
import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { AccountPrivacyPanel } from "../components/AccountPrivacyPanel";
import { User, CreditCard, Bell, Globe, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSidebar } from "../contexts/SidebarContext";
import { useAuth } from "../integration/auth-context";
import type { BillingPlanResponseData, MeResponseData, SettingsResponseData, UsageSummary } from "../integration/api-types";
import { ApiClientError } from "../integration/api-error";
import { planName } from "../integration/cancel-offer";

const isPurchasePlan = (code: string): code is "weekly" | "monthly" | "annual" => code === "weekly" || code === "monthly" || code === "annual";

export function Profile() {
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const { setSidebarVisible } = useSidebar();
  const { api, refreshMe } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [billingBusy, setBillingBusy] = useState<"checkout" | "portal" | "cancel" | "payment_method" | "keep" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [meData, setMeData] = useState<MeResponseData | null>(null);
  const [settings, setSettings] = useState<SettingsResponseData | null>(null);
  const [billingPlan, setBillingPlan] = useState<BillingPlanResponseData | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const [fullName, setFullName] = useState("");
  const [defaultCvLanguage, setDefaultCvLanguage] = useState("en");
  const [locale, setLocale] = useState<"en" | "tr">(i18n.language === "tr" ? "tr" : "en");
  useEffect(() => { setLocale(i18n.language === "tr" ? "tr" : "en"); }, [i18n.language]);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [applicationReminders, setApplicationReminders] = useState(true);

  useEffect(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  const load = async () => {
    setLoading(true);
    setError(null);

    try {
      const [me, settingsResponse, plan, usageResponse] = await Promise.all([
        api.getMe(),
        api.getSettings(),
        api.getBillingPlan(),
        api.getBillingUsage()
      ]);

      setMeData(me);
      setSettings(settingsResponse.settings);
      setBillingPlan(plan);
      setUsage(usageResponse);

      setFullName(me.user.full_name ?? "");
      setDefaultCvLanguage(settingsResponse.settings.default_cv_language ?? "en");
    } catch (err) {
      if (err instanceof ApiClientError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("Failed to load profile."));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveProfile = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      await Promise.all([
        api.patchMe({
          full_name: fullName,
          default_cv_language: defaultCvLanguage
        }),
        api.patchSettings({
          default_cv_language: defaultCvLanguage,
          onboarding_completed: settings?.onboarding_completed ?? true
        })
      ]);

      await Promise.all([refreshMe(), load()]);
      setSuccess("Profile updated successfully.");
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("Failed to save profile."));
      }
    } finally {
      setSaving(false);
    }
  };

  const openCheckout = async () => {
    // Checkout sends accounts that finished onboarding to the app instead of the upload step.
    navigate(checkoutPath({ with_trial: billingPlan?.trial_eligible !== false, return_path: ONBOARDING_ENTRY_PATH }));
  };

  // "payment_method" opens the portal directly on that step. Cancelling goes through /app/cancel.
  const openPortal = async (flow?: "payment_method") => {
    setBillingBusy(flow ?? "portal");
    setError(null);

    try {
      const response = await api.createBillingPortal({
        return_url: `${window.location.origin}/app/profile`,
        ...(flow ? { flow } : {})
      });
      window.location.href = response.portal_url;
    } catch (err) {
      if (
        err instanceof ApiClientError &&
        err.code === "VALIDATION_ERROR" &&
        err.details?.reason === "provider_customer_not_found"
      ) {
        await openCheckout();
        return;
      }

      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("Failed to open billing portal."));
      }
      setBillingBusy(null);
    }
  };

  const planCode = billingPlan?.plan_code ?? meData?.current_plan.plan_code ?? "free";
  const billingIssue = hasBillingIssue(billingPlan);
  const isTrialing = planCode !== "free" && billingPlan?.subscription_status === "trialing";
  const periodEnd = billingPlan?.current_period_end ?? meData?.current_plan.current_period_end ?? null;
  const cancelScheduled = billingPlan?.cancel_at_period_end ?? meData?.current_plan.cancel_at_period_end ?? false;
  const periodEndLabel = periodEnd ? new Date(periodEnd).toLocaleDateString(localeCode(), { month: "long", day: "numeric", year: "numeric" }) : null;
  const busyLabel = (key: typeof billingBusy, label: string) => billingBusy === key ? t("Redirecting...") : label;
  // A downgrade (or the paid-weekly offer's switch) waiting for the end of the paid period.
  const scheduledChange = billingPlan?.scheduled_change ?? null;
  const formatPlanDate = (iso: string) => new Date(iso).toLocaleDateString(localeCode(), { month: "long", day: "numeric", year: "numeric" });
  const keepCurrentPlan = async () => {
    setBillingBusy("keep");
    setError(null);
    try {
      setBillingPlan(await api.keepCurrentPlan());
    } catch (err) {
      setError(err instanceof Error ? err.message : t("We couldn’t keep your current plan. Please try again."));
    } finally {
      setBillingBusy(null);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-medium mb-1" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
          {t("Profile & Settings")}</h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          {t("Manage your account preferences")}</p>
      </div>

      {loading && <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>{t("Loading profile...")}</p>}

      {error && (
        <div
          className="mb-6 p-4 rounded-lg border"
          style={{
            borderColor: "var(--color-red-200)",
            background: "var(--color-red-50)",
            color: "var(--color-red-700)",
            fontSize: "13px"
          }}
        >
          {t(error)}
        </div>
      )}

      {success && (
        <div
          className="mb-6 p-4 rounded-lg border"
          style={{
            borderColor: "var(--color-teal-200)",
            background: "var(--color-teal-50)",
            color: "var(--color-teal-800)",
            fontSize: "13px"
          }}
        >
          {success}
        </div>
      )}

      {!loading && (
        <div className="max-w-3xl space-y-6">
          <div
            className="p-5 rounded-xl border"
            style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--color-teal-50)" }}>
                <User size={20} style={{ color: "var(--color-teal-600)" }} />
              </div>
              <div className="flex-1">
                <h3 className="font-medium mb-1" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                  {t("Account information")}</h3>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {t("Update your personal details")}</p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block mb-2" style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                  {t("Full name")}</label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  className="w-full px-3 py-2 rounded-lg border"
                  style={{
                    fontSize: "13px",
                    borderColor: "var(--color-border-secondary)",
                    background: "var(--color-background-primary)"
                  }}
                />
              </div>
              <div>
                <label className="block mb-2" style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                  {t("Email")}</label>
                <input
                  type="email"
                  value={meData?.user.email ?? ""}
                    className="w-full px-3 py-2 rounded-lg border"
                  style={{
                    fontSize: "13px",
                    borderColor: "var(--color-border-secondary)",
                    background: "var(--color-background-secondary)",
                    color: "var(--color-text-secondary)"
                  }}
                />
              </div>
              <button
                onClick={() => void saveProfile()}
                disabled={saving}
                className="px-4 py-2 rounded-lg font-medium inline-flex items-center gap-2"
                style={{
                  fontSize: "13px",
                  background: "var(--color-teal-600)",
                  color: "var(--color-teal-50)",
                  opacity: saving ? 0.7 : 1
                }}
              >
                {saving && <Loader2 size={14} className="animate-spin" />}
                {saving ? t("Saving...") : t("Save changes")}
              </button>
            </div>
          </div>

          <div
            className="p-5 rounded-xl border"
            style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--color-teal-50)" }}>
                <CreditCard size={20} style={{ color: "var(--color-teal-600)" }} />
              </div>
              <div className="flex-1">
                <h3 className="font-medium mb-1" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                  {t("Current plan")}</h3>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {t("Manage your subscription and billing")}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-lg" style={{ background: "var(--color-background-secondary)" }}>
              <div className="flex-1" style={{ minWidth: "220px" }}>
                <p className="font-medium mb-0.5" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                  {billingIssue ? t("Payment failed") : isTrialing ? t("Free trial") : planCode === "free" ? t("Subscription inactive") : `${planCode.toUpperCase()} ${t("Plan")}`}</p>
                <p style={{ fontSize: "12px", color: billingIssue ? "var(--color-red-700)" : "var(--color-text-secondary)" }}>
                  {billingIssue
                    ? t("Your last payment didn’t go through. Update your payment method to keep your Pro subscription.")
                    : isTrialing && periodEndLabel
                      ? cancelScheduled
                        ? t("Your trial is canceled. You keep Pro until {{date}} and won’t be charged.", { date: periodEndLabel })
                        : t("Your trial ends on {{date}}. Cancel before then and you won’t be charged. We’ll email you a reminder first.", { date: periodEndLabel })
                      : planCode === "free" ? t("Start a free 3-day trial to download your CVs and unlock every AI feature.") : usage
                        ? t("Unlimited CVs and exports with your subscription.")
                        : t("Loading usage...")}
                </p>
                {scheduledChange && (
                  <p className="flex flex-wrap items-center gap-x-2" style={{ fontSize: "12px", color: "var(--color-teal-700)", marginTop: "4px" }}>
                    {t("Switching to {{plan}} on {{date}}", { plan: t(planName(scheduledChange.plan_code)), date: formatPlanDate(scheduledChange.starts_at) })}
                    {isPurchasePlan(planCode) && (
                      <button type="button" onClick={() => void keepCurrentPlan()} disabled={billingBusy !== null}
                        style={{ fontSize: "12px", color: "var(--color-teal-800)", textDecoration: "underline" }}>
                        {billingBusy === "keep" ? t("Saving...") : t("Keep {{plan}}", { plan: t(planName(planCode)) })}
                      </button>
                    )}
                  </p>
                )}
                {planCode !== "free" && !isTrialing && periodEndLabel && !scheduledChange && (
                  <p style={{ fontSize: "12px", color: cancelScheduled ? "var(--color-red-600)" : "var(--color-teal-700)", marginTop: "4px" }}>
                    {cancelScheduled ? t("Expires on ") : t("Renews on ")}
                    {periodEndLabel}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {billingIssue ? (
                  <button
                    onClick={() => void openPortal("payment_method")}
                    disabled={billingBusy !== null}
                    className="px-4 py-2 rounded-lg font-medium"
                    style={{ fontSize: "13px", background: "var(--color-teal-600)", color: "var(--color-teal-50)", opacity: billingBusy ? 0.7 : 1 }}
                  >
                    {busyLabel("payment_method", t("Update payment method"))}
                  </button>
                ) : planCode === "free" ? (
                  <button
                    onClick={() => { setBillingBusy("checkout"); void openCheckout(); }}
                    disabled={billingBusy !== null}
                    className="px-4 py-2 rounded-lg font-medium"
                    style={{
                      fontSize: "13px",
                      background: "var(--color-teal-600)",
                      color: "var(--color-teal-50)",
                      opacity: billingBusy ? 0.7 : 1
                    }}
                  >
                    {billingBusy ? t("Redirecting...") : billingPlan?.trial_eligible ? t("Start Free Trial") : t("Choose Pro")}
                  </button>
                ) : (
                  <>
                    {!cancelScheduled && (
                      <button
                        // The cancel screen (the plan's offer, or what Pro includes) opens Stripe's cancellation itself.
                        onClick={() => navigate("/app/cancel")}
                        disabled={billingBusy !== null}
                        className="px-4 py-2 rounded-lg font-medium border"
                        style={{
                          fontSize: "13px",
                          background: "var(--color-background-primary)",
                          borderColor: "var(--color-border-secondary)",
                          color: "var(--color-text-primary)",
                          opacity: billingBusy ? 0.7 : 1
                        }}
                      >
                        {busyLabel("cancel", isTrialing ? t("Cancel trial") : t("Cancel subscription"))}
                      </button>
                    )}
                    <button
                      onClick={() => void openPortal()}
                      disabled={billingBusy !== null}
                      className="px-4 py-2 rounded-lg font-medium"
                      style={{
                        fontSize: "13px",
                        background: "var(--color-teal-600)",
                        color: "var(--color-teal-50)",
                        opacity: billingBusy ? 0.7 : 1
                      }}
                    >
                      {busyLabel("portal", t("Manage billing"))}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div
            className="p-5 rounded-xl border"
            style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--color-teal-50)" }}>
                <Bell size={20} style={{ color: "var(--color-teal-600)" }} />
              </div>
              <div className="flex-1">
                <h3 className="font-medium mb-1" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                  {t("Notifications")}</h3>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {t("UI preferences (local only in Phase 4.5)")}</p>
              </div>
            </div>
            <div className="space-y-3">
              <label className="flex items-center justify-between p-3 rounded-lg cursor-pointer" style={{ background: "var(--color-background-secondary)" }}>
                <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>{t("Email notifications")}</span>
                <input
                  type="checkbox"
                  checked={emailNotifications}
                  onChange={(event) => setEmailNotifications(event.target.checked)}
                  className="rounded"
                />
              </label>
              <label className="flex items-center justify-between p-3 rounded-lg cursor-pointer" style={{ background: "var(--color-background-secondary)" }}>
                <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>{t("Application reminders")}</span>
                <input
                  type="checkbox"
                  checked={applicationReminders}
                  onChange={(event) => setApplicationReminders(event.target.checked)}
                  className="rounded"
                />
              </label>
            </div>
          </div>

          <div
            className="p-5 rounded-xl border"
            style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
          >
            <div className="flex items-start gap-4 mb-4">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--color-teal-50)" }}>
                <Globe size={20} style={{ color: "var(--color-teal-600)" }} />
              </div>
              <div className="flex-1">
                <h3 className="font-medium mb-1" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                  {t("Locale & default CV language")}</h3>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {t("Saved via `/me/settings`")}</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select
                value={locale}
                onChange={event => { const value = event.target.value as "en" | "tr"; setLocale(value); chooseLocale(value); }}
                className="w-full px-3 py-2 rounded-lg border"
                disabled
                style={{
                  fontSize: "13px",
                  borderColor: "var(--color-border-secondary)",
                  background: "var(--color-background-secondary)",
                  color: "var(--color-text-secondary)"
                }}
              >
                <option value="en">{t("English")}</option>
                <option value="tr">{t("Turkish")}</option>
              </select>

              <input
                value={defaultCvLanguage}
                onChange={(event) => setDefaultCvLanguage(event.target.value)}
                placeholder={t("Default CV language (e.g. en)")}
                className="w-full px-3 py-2 rounded-lg border"
                style={{
                  fontSize: "13px",
                  borderColor: "var(--color-border-secondary)",
                  background: "var(--color-background-primary)"
                }}
              />
            </div>
          </div>
        </div>
      )}
      {!loading && <AccountPrivacyPanel />}
    </div>
  );
}

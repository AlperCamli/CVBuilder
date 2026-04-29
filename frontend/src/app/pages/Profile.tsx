import { User, CreditCard, Bell, Globe, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useSidebar } from "../contexts/SidebarContext";
import { useAuth } from "../integration/auth-context";
import type { BillingPlanResponseData, MeResponseData, SettingsResponseData, UsageSummary } from "../integration/api-types";
import { ApiClientError } from "../integration/api-error";

export function Profile() {
  const { setSidebarVisible } = useSidebar();
  const { api, refreshMe } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [meData, setMeData] = useState<MeResponseData | null>(null);
  const [settings, setSettings] = useState<SettingsResponseData | null>(null);
  const [billingPlan, setBillingPlan] = useState<BillingPlanResponseData | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);

  const [fullName, setFullName] = useState("");
  const [defaultCvLanguage, setDefaultCvLanguage] = useState("en");
  const [locale] = useState<"en">("en");
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
        setError("Failed to load profile.");
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
          locale: "en",
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
        setError("Failed to save profile.");
      }
    } finally {
      setSaving(false);
    }
  };

  const openCheckout = async () => {
    setBillingBusy(true);
    setError(null);

    try {
      const base = window.location.origin;
      const response = await api.createBillingCheckout({
        plan_code: "pro",
        success_url: `${base}/app/pricing?checkout=success`,
        cancel_url: `${base}/app/profile?checkout=cancel`
      });
      window.location.href = response.checkout_url;
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to open checkout.");
      }
      setBillingBusy(false);
    }
  };

  const openPortal = async () => {
    setBillingBusy(true);
    setError(null);

    try {
      const response = await api.createBillingPortal({
        return_url: `${window.location.origin}/app/profile`
      });
      window.location.href = response.portal_url;
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to open billing portal.");
      }
      setBillingBusy(false);
    }
  };

  const planCode = billingPlan?.plan_code ?? meData?.current_plan.plan_code ?? "free";

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="font-medium mb-1" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
          Profile & Settings
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Manage your account preferences
        </p>
      </div>

      {loading && <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>Loading profile...</p>}

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
          {error}
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
                  Account information
                </h3>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  Update your personal details
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block mb-2" style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                  Full name
                </label>
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
                  Email
                </label>
                <input
                  type="email"
                  value={meData?.user.email ?? ""}
                  disabled
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
                {saving ? "Saving..." : "Save changes"}
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
                  Current plan
                </h3>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  Manage your subscription and billing
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg" style={{ background: "var(--color-background-secondary)" }}>
              <div>
                <p className="font-medium mb-0.5" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                  {planCode.toUpperCase()} Plan
                </p>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {usage
                    ? `${usage.remaining.tailored_cv_generations ?? "∞"} tailored CV generations remaining this month`
                    : "Loading usage..."}
                </p>
                {planCode !== "free" && meData?.current_plan.current_period_end && (
                  <p style={{ fontSize: "12px", color: meData.current_plan.cancel_at_period_end ? "var(--color-red-600)" : "var(--color-teal-700)", marginTop: "4px" }}>
                    {meData.current_plan.cancel_at_period_end ? "Expires on " : "Renews on "}
                    {new Date(meData.current_plan.current_period_end).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {planCode === "free" ? (
                  <button
                    onClick={() => void openCheckout()}
                    disabled={billingBusy}
                    className="px-4 py-2 rounded-lg font-medium"
                    style={{
                      fontSize: "13px",
                      background: "var(--color-teal-600)",
                      color: "var(--color-teal-50)",
                      opacity: billingBusy ? 0.7 : 1
                    }}
                  >
                    {billingBusy ? "Redirecting..." : "Upgrade to Pro"}
                  </button>
                ) : (
                  <button
                    onClick={() => void openPortal()}
                    disabled={billingBusy}
                    className="px-4 py-2 rounded-lg font-medium"
                    style={{
                      fontSize: "13px",
                      background: "var(--color-teal-600)",
                      color: "var(--color-teal-50)",
                      opacity: billingBusy ? 0.7 : 1
                    }}
                  >
                    {billingBusy ? "Redirecting..." : "Manage billing"}
                  </button>
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
                  Notifications
                </h3>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  UI preferences (local only in Phase 4.5)
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <label className="flex items-center justify-between p-3 rounded-lg cursor-pointer" style={{ background: "var(--color-background-secondary)" }}>
                <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>Email notifications</span>
                <input
                  type="checkbox"
                  checked={emailNotifications}
                  onChange={(event) => setEmailNotifications(event.target.checked)}
                  className="rounded"
                />
              </label>
              <label className="flex items-center justify-between p-3 rounded-lg cursor-pointer" style={{ background: "var(--color-background-secondary)" }}>
                <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>Application reminders</span>
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
                  Locale & default CV language
                </h3>
                <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  Saved via `/me/settings`
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <select
                value={locale}
                className="w-full px-3 py-2 rounded-lg border"
                disabled
                style={{
                  fontSize: "13px",
                  borderColor: "var(--color-border-secondary)",
                  background: "var(--color-background-secondary)",
                  color: "var(--color-text-secondary)"
                }}
              >
                <option value="en">English</option>
              </select>

              <input
                value={defaultCvLanguage}
                onChange={(event) => setDefaultCvLanguage(event.target.value)}
                placeholder="Default CV language (e.g. en)"
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
    </div>
  );
}

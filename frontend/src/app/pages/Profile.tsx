import { User, CreditCard, Bell, Globe } from "lucide-react";
import { useEffect } from "react";
import { useSidebar } from "../contexts/SidebarContext";

export function Profile() {
  const { setSidebarVisible } = useSidebar();

  // Show sidebar when on this page
  useEffect(() => {
    setSidebarVisible(true);
  }, [setSidebarVisible]);

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-medium mb-1" style={{ fontSize: "22px", color: "var(--color-text-primary)" }}>
          Profile & Settings
        </h1>
        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
          Manage your account preferences
        </p>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Account Info */}
        <div
          className="p-5 rounded-xl border"
          style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
        >
          <div className="flex items-start gap-4 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: "var(--color-teal-50)" }}
            >
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
                defaultValue="Sarah Johnson"
                className="w-full px-3 py-2 rounded-lg border"
                style={{
                  fontSize: "13px",
                  borderColor: "var(--color-border-secondary)",
                  background: "var(--color-background-primary)",
                }}
              />
            </div>
            <div>
              <label className="block mb-2" style={{ fontSize: "12px", fontWeight: 500, color: "var(--color-text-primary)" }}>
                Email
              </label>
              <input
                type="email"
                defaultValue="sarah@example.com"
                className="w-full px-3 py-2 rounded-lg border"
                style={{
                  fontSize: "13px",
                  borderColor: "var(--color-border-secondary)",
                  background: "var(--color-background-primary)",
                }}
              />
            </div>
            <button
              className="px-4 py-2 rounded-lg font-medium"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-600)",
                color: "var(--color-teal-50)",
              }}
            >
              Save changes
            </button>
          </div>
        </div>

        {/* Plan */}
        <div
          className="p-5 rounded-xl border"
          style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
        >
          <div className="flex items-start gap-4 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: "var(--color-teal-50)" }}
            >
              <CreditCard size={20} style={{ color: "var(--color-teal-600)" }} />
            </div>
            <div className="flex-1">
              <h3 className="font-medium mb-1" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                Current plan
              </h3>
              <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                Manage your subscription
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 rounded-lg" style={{ background: "var(--color-background-secondary)" }}>
            <div>
              <p className="font-medium mb-0.5" style={{ fontSize: "14px", color: "var(--color-text-primary)" }}>
                Free Plan
              </p>
              <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                2/2 tailored CVs used
              </p>
            </div>
            <button
              className="px-4 py-2 rounded-lg font-medium"
              style={{
                fontSize: "13px",
                background: "var(--color-teal-600)",
                color: "var(--color-teal-50)",
              }}
            >
              Upgrade to Pro
            </button>
          </div>
        </div>

        {/* Preferences */}
        <div
          className="p-5 rounded-xl border"
          style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
        >
          <div className="flex items-start gap-4 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: "var(--color-teal-50)" }}
            >
              <Bell size={20} style={{ color: "var(--color-teal-600)" }} />
            </div>
            <div className="flex-1">
              <h3 className="font-medium mb-1" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                Notifications
              </h3>
              <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                Manage how you receive updates
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <label className="flex items-center justify-between p-3 rounded-lg cursor-pointer" style={{ background: "var(--color-background-secondary)" }}>
              <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                Email notifications
              </span>
              <input type="checkbox" defaultChecked className="rounded" />
            </label>
            <label className="flex items-center justify-between p-3 rounded-lg cursor-pointer" style={{ background: "var(--color-background-secondary)" }}>
              <span style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                Application reminders
              </span>
              <input type="checkbox" defaultChecked className="rounded" />
            </label>
          </div>
        </div>

        {/* Language */}
        <div
          className="p-5 rounded-xl border"
          style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)" }}
        >
          <div className="flex items-start gap-4 mb-4">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: "var(--color-teal-50)" }}
            >
              <Globe size={20} style={{ color: "var(--color-teal-600)" }} />
            </div>
            <div className="flex-1">
              <h3 className="font-medium mb-1" style={{ fontSize: "15px", color: "var(--color-text-primary)" }}>
                Language
              </h3>
              <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                Choose your preferred language
              </p>
            </div>
          </div>
          <select
            className="w-full px-3 py-2 rounded-lg border"
            style={{
              fontSize: "13px",
              borderColor: "var(--color-border-secondary)",
              background: "var(--color-background-primary)",
            }}
          >
            <option>English (US)</option>
            <option>English (UK)</option>
            <option>Spanish</option>
            <option>French</option>
            <option>German</option>
          </select>
        </div>
      </div>
    </div>
  );
}
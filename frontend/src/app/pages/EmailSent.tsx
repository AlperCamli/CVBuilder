import { useState } from "react";
import { Link, useLocation } from "react-router";
import { Mail, ArrowLeft, RefreshCw } from "lucide-react";
import { supabase } from "../integration/supabase-client";

export function EmailSent() {
  const location = useLocation();
  const email = (location.state as { email?: string })?.email ?? "";
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleResend = async () => {
    if (cooldown > 0 || resending) {
      return;
    }

    setResending(true);
    setError(null);

    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email
      });

      if (resendError) {
        throw resendError;
      }

      setResent(true);
      setCooldown(60);
      const interval = setInterval(() => {
        setCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Failed to resend email.");
      }
    } finally {
      setResending(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: "var(--color-background-secondary)" }}
    >
      <div
        className="w-full max-w-md rounded-2xl border p-7 text-center"
        style={{
          background: "var(--color-background-primary)",
          borderColor: "var(--color-border-tertiary)"
        }}
      >
        <div className="flex justify-center mb-5">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{ background: "var(--color-teal-50)" }}
          >
            <Mail size={28} style={{ color: "var(--color-teal-700)" }} />
          </div>
        </div>

        <h1 style={{ fontSize: "24px", color: "var(--color-text-primary)", fontWeight: 600 }}>
          Check your email
        </h1>
        <p style={{ fontSize: "14px", color: "var(--color-text-secondary)", marginTop: "6px", lineHeight: "1.6" }}>
          We sent a verification link to:
        </p>
        {email && (
          <p style={{ fontSize: "14px", color: "var(--color-teal-700)", marginTop: "6px", fontWeight: 600 }}>
            {email}
          </p>
        )}

        <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", marginTop: "16px", lineHeight: "1.6" }}>
          Open the email and click the verification link. If it is not in your inbox, check your spam folder.
        </p>

        {error && (
          <div
            className="mt-4 p-3 rounded-lg border text-left"
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

        {resent && !error && (
          <div
            className="mt-4 p-3 rounded-lg border"
            style={{
              borderColor: "var(--color-teal-200)",
              background: "var(--color-teal-50)",
              color: "var(--color-teal-800)",
              fontSize: "13px"
            }}
          >
            Verification email resent successfully.
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={cooldown > 0 || resending || !email}
          className="w-full mt-5 py-2.5 rounded-lg font-medium flex items-center justify-center gap-2"
          style={{
            fontSize: "13px",
            background: cooldown > 0 || resending ? "var(--color-background-secondary)" : "var(--color-teal-600)",
            color: cooldown > 0 || resending ? "var(--color-text-secondary)" : "var(--color-teal-50)",
            cursor: cooldown > 0 || resending ? "not-allowed" : "pointer"
          }}
        >
          <RefreshCw size={14} className={resending ? "animate-spin" : ""} />
          {resending
            ? "Resending..."
            : cooldown > 0
              ? `Resend email (${cooldown}s)`
              : "Resend verification email"}
        </button>

        <Link
          to="/signin"
          className="inline-flex items-center gap-2 mt-4"
          style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}
        >
          <ArrowLeft size={14} />
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

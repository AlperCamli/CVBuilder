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
      className="min-h-screen flex items-center justify-center p-8"
      style={{
        background:
          "linear-gradient(135deg, var(--color-slate-950) 0%, var(--color-teal-900) 50%, var(--color-teal-600) 100%)"
      }}
    >
      <div
        className="w-full max-w-md p-8 rounded-2xl border text-center"
        style={{
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(20px)",
          borderColor: "rgba(255, 255, 255, 0.2)",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25), 0 0 80px rgba(29, 158, 117, 0.15)"
        }}
      >
        <div className="flex justify-center mb-6">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, var(--color-teal-50) 0%, var(--color-teal-100) 100%)",
              animation: "emailPulse 2s ease-in-out infinite"
            }}
          >
            <Mail size={36} style={{ color: "var(--color-teal-600)" }} />
          </div>
        </div>

        <h1 className="font-semibold mb-2" style={{ fontSize: "24px", color: "var(--color-text-primary)" }}>
          Check your email
        </h1>
        <p className="mb-2" style={{ fontSize: "14px", color: "var(--color-text-secondary)", lineHeight: "1.6" }}>
          We've sent a verification link to
        </p>
        {email && (
          <p className="mb-6 font-medium" style={{ fontSize: "15px", color: "var(--color-teal-700)" }}>
            {email}
          </p>
        )}
        <p className="mb-8" style={{ fontSize: "13px", color: "var(--color-slate-400)", lineHeight: "1.6" }}>
          Click the link in the email to verify your account and get started.
          If you don't see it, check your spam folder.
        </p>

        {error && (
          <div
            className="mb-4 p-3 rounded-lg text-left"
            style={{
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
            className="mb-4 p-3 rounded-lg"
            style={{
              background: "var(--color-teal-50)",
              color: "var(--color-teal-700)",
              fontSize: "13px"
            }}
          >
            Verification email resent successfully!
          </div>
        )}

        <button
          type="button"
          onClick={() => void handleResend()}
          disabled={cooldown > 0 || resending || !email}
          className="w-full py-3 rounded-lg font-medium transition-all flex items-center justify-center gap-2 mb-4"
          style={{
            fontSize: "14px",
            background: cooldown > 0 || resending ? "var(--color-slate-200)" : "var(--color-teal-600)",
            color: cooldown > 0 || resending ? "var(--color-slate-400)" : "var(--color-teal-50)",
            cursor: cooldown > 0 || resending ? "not-allowed" : "pointer"
          }}
        >
          <RefreshCw size={16} className={resending ? "animate-spin" : ""} />
          {resending
            ? "Resending..."
            : cooldown > 0
              ? `Resend email (${cooldown}s)`
              : "Resend verification email"}
        </button>

        <Link
          to="/signin"
          className="inline-flex items-center gap-2 font-medium transition-colors"
          style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}
        >
          <ArrowLeft size={14} />
          Back to sign in
        </Link>
      </div>

      <style>{`
        @keyframes emailPulse {
          0%, 100% {
            transform: scale(1);
            box-shadow: 0 0 0 0 rgba(29, 158, 117, 0.3);
          }
          50% {
            transform: scale(1.05);
            box-shadow: 0 0 0 16px rgba(29, 158, 117, 0);
          }
        }
      `}</style>
    </div>
  );
}

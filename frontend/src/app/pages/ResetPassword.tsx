import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ArrowLeft, Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { useAuth } from "../integration/auth-context";
import { mapAuthErrorMessage } from "../integration/auth-error-mapper";
import { hasSupabaseConfig } from "../integration/config";
import { supabase } from "../integration/supabase-client";

type RecoveryStatus = "checking" | "ready" | "invalid";

const RESET_SUCCESS_MESSAGE = "Password updated successfully. Please sign in with your new password.";

export function ResetPassword() {
  const navigate = useNavigate();
  const { updatePassword, signOut } = useAuth();

  const [status, setStatus] = useState<RecoveryStatus>("checking");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    return (
      hasSupabaseConfig &&
      status === "ready" &&
      !isSubmitting &&
      password.length >= 8 &&
      confirmPassword.length >= 8
    );
  }, [confirmPassword.length, isSubmitting, password.length, status]);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setStatus("invalid");
      setStatusMessage(
        "Supabase configuration is missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
      );
      return;
    }

    let disposed = false;

    const hashParams = new URLSearchParams(
      window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash
    );
    const queryParams = new URLSearchParams(window.location.search);

    const hashError = hashParams.get("error_description");
    const queryError = queryParams.get("error_description");

    if (hashError || queryError) {
      setStatus("invalid");
      setStatusMessage(
        mapAuthErrorMessage("reset_password", {
          message: hashError || queryError || ""
        })
      );
      return;
    }

    const hasRecoveryMarker =
      hashParams.get("type") === "recovery" || queryParams.get("type") === "recovery";

    const applySessionState = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (disposed) {
        return;
      }

      if (error) {
        setStatus("invalid");
        setStatusMessage(mapAuthErrorMessage("reset_password", error));
        return;
      }

      if (data.session) {
        setStatus("ready");
        setStatusMessage(null);
        return;
      }

      if (!hasRecoveryMarker) {
        setStatus("invalid");
        setStatusMessage(
          "This password reset link is invalid or has expired. Request a new reset link."
        );
      }
    };

    void applySessionState();

    const timeout = window.setTimeout(() => {
      if (disposed) {
        return;
      }

      void supabase.auth.getSession().then(({ data }) => {
        if (disposed) {
          return;
        }

        if (!data.session) {
          setStatus("invalid");
          setStatusMessage(
            "This password reset link is invalid or has expired. Request a new reset link."
          );
        }
      });
    }, 2000);

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (disposed) {
        return;
      }

      if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && nextSession) {
        setStatus("ready");
        setStatusMessage(null);
      }
    });

    return () => {
      disposed = true;
      clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (password !== confirmPassword) {
      setSubmitError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      await updatePassword(password);
      await signOut();
      navigate("/signin", {
        replace: true,
        state: { message: RESET_SUCCESS_MESSAGE }
      });
    } catch (error) {
      setSubmitError(mapAuthErrorMessage("reset_password", error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (status === "checking") {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
        <div className="text-center">
          <Loader2
            size={32}
            className="animate-spin mx-auto mb-4"
            style={{ color: "var(--color-teal-600)" }}
          />
          <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
            Validating reset link...
          </p>
        </div>
      </div>
    );
  }

  if (status === "invalid") {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
        <div
          className="w-full max-w-md rounded-2xl border p-7"
          style={{
            background: "var(--color-background-primary)",
            borderColor: "var(--color-border-tertiary)"
          }}
        >
          <h1
            className="font-semibold mb-3"
            style={{ fontSize: "24px", color: "var(--color-text-primary)" }}
          >
            Reset link unavailable
          </h1>
          <p style={{ fontSize: "14px", color: "var(--color-text-secondary)", lineHeight: "1.6" }}>
            {statusMessage ||
              "This password reset link is invalid or has expired. Request a new reset link."}
          </p>
          <Link
            to="/forgot-password"
            className="inline-flex items-center gap-2 font-medium mt-5"
            style={{ fontSize: "14px", color: "var(--color-teal-600)" }}
          >
            <ArrowLeft size={16} />
            Request new reset link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 mb-12">
          <div
            className="w-8 h-8 rounded-md"
            style={{ background: "var(--color-teal-600)" }}
          />
          <span
            className="font-semibold"
            style={{ fontSize: "20px", color: "var(--color-text-primary)" }}
          >
            ResumÃ©
          </span>
        </Link>

        <div
          className="bg-white rounded-2xl p-8"
          style={{ border: "1px solid var(--color-border-tertiary)" }}
        >
          <Link
            to="/signin"
            className="inline-flex items-center gap-2 mb-8 font-medium transition-colors"
            style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}
          >
            <ArrowLeft size={16} />
            Back to sign in
          </Link>

          <div className="mb-8">
            <h1
              className="font-semibold mb-2"
              style={{ fontSize: "28px", color: "var(--color-text-primary)" }}
            >
              Set a new password
            </h1>
            <p style={{ fontSize: "15px", color: "var(--color-text-secondary)", lineHeight: "1.6" }}>
              Enter your new password below to finish recovering your account.
            </p>
          </div>

          {submitError && (
            <div
              className="mb-5 p-3 rounded-lg border"
              style={{
                borderColor: "var(--color-red-200)",
                background: "var(--color-red-50)",
                color: "var(--color-red-700)",
                fontSize: "13px"
              }}
            >
              {submitError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="password" className="block mb-2 font-medium" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                New password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-text-tertiary)" }} />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  required
                  minLength={8}
                  className="w-full pl-10 pr-12 py-2.5 rounded-lg border"
                  style={{
                    fontSize: "14px",
                    borderColor: "var(--color-border-secondary)",
                    outline: "none"
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--color-background-secondary)]"
                >
                  {showPassword ? (
                    <EyeOff size={16} style={{ color: "var(--color-text-tertiary)" }} />
                  ) : (
                    <Eye size={16} style={{ color: "var(--color-text-tertiary)" }} />
                  )}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block mb-2 font-medium" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                Confirm new password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-text-tertiary)" }} />
                <input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter your new password"
                  required
                  minLength={8}
                  className="w-full pl-10 pr-12 py-2.5 rounded-lg border"
                  style={{
                    fontSize: "14px",
                    borderColor: "var(--color-border-secondary)",
                    outline: "none"
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-[var(--color-background-secondary)]"
                >
                  {showConfirmPassword ? (
                    <EyeOff size={16} style={{ color: "var(--color-text-tertiary)" }} />
                  ) : (
                    <Eye size={16} style={{ color: "var(--color-text-tertiary)" }} />
                  )}
                </button>
              </div>
              <p className="mt-1.5" style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                Must be at least 8 characters.
              </p>
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-3 rounded-lg font-medium transition-all"
              style={{
                fontSize: "14px",
                background: canSubmit ? "var(--color-teal-600)" : "var(--color-text-tertiary)",
                color: "white",
                cursor: canSubmit ? "pointer" : "not-allowed"
              }}
            >
              {isSubmitting ? "Updating..." : "Update password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

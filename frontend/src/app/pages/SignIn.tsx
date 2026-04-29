import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Mail, Lock, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../integration/auth-context";
import { hasSupabaseConfig } from "../integration/config";

export function SignIn() {
  const navigate = useNavigate();
  const { signIn, signInWithGoogle } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setIsGoogleLoading(true);

    try {
      await signInWithGoogle();
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Google sign-in failed. Please try again.");
      }
      setIsGoogleLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      await signIn(email, password);
      navigate("/app", { replace: true });
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Sign-in failed. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <Link to="/" className="flex items-center gap-2 mb-12">
            <div className="w-8 h-8 rounded-md" style={{ background: "var(--color-teal-600)" }} />
            <span className="font-semibold" style={{ fontSize: "20px", color: "var(--color-text-primary)" }}>
              Resumé
            </span>
          </Link>

          <div className="mb-8">
            <h1 className="font-semibold mb-2" style={{ fontSize: "32px", color: "var(--color-text-primary)" }}>
              Welcome back
            </h1>
            <p style={{ fontSize: "15px", color: "var(--color-text-secondary)" }}>
              Sign in to continue building your career
            </p>
          </div>

          {!hasSupabaseConfig && (
            <div
              className="mb-5 p-3 rounded-lg border"
              style={{
                borderColor: "var(--color-red-200)",
                background: "var(--color-red-50)",
                color: "var(--color-red-700)",
                fontSize: "13px"
              }}
            >
              Missing frontend Supabase env vars. Set `VITE_SUPABASE_URL` and
              `VITE_SUPABASE_ANON_KEY`.
            </div>
          )}

          {errorMessage && (
            <div
              className="mb-5 p-3 rounded-lg border"
              style={{
                borderColor: "var(--color-red-200)",
                background: "var(--color-red-50)",
                color: "var(--color-red-700)",
                fontSize: "13px"
              }}
            >
              {errorMessage}
            </div>
          )}

          <button
            type="button"
            onClick={() => void handleGoogleSignIn()}
            disabled={isGoogleLoading || !hasSupabaseConfig}
            className="w-full py-3 rounded-lg font-medium transition-all flex items-center justify-center gap-3 border"
            style={{
              fontSize: "14px",
              background: "var(--color-background-primary)",
              color: "var(--color-text-primary)",
              borderColor: "var(--color-border-secondary)",
              cursor: isGoogleLoading || !hasSupabaseConfig ? "not-allowed" : "pointer",
              opacity: isGoogleLoading || !hasSupabaseConfig ? 0.6 : 1
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            {isGoogleLoading ? "Connecting..." : "Continue with Google"}
          </button>

          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px" style={{ background: "var(--color-border-secondary)" }} />
            <span style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>or</span>
            <div className="flex-1 h-px" style={{ background: "var(--color-border-secondary)" }} />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="email" className="block mb-2 font-medium" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                Email address
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-text-tertiary)" }} />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border transition-colors"
                  style={{
                    fontSize: "14px",
                    borderColor: "var(--color-border-secondary)",
                    outline: "none"
                  }}
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block mb-2 font-medium" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-text-tertiary)" }} />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  required
                  className="w-full pl-10 pr-12 py-2.5 rounded-lg border transition-colors"
                  style={{
                    fontSize: "14px",
                    borderColor: "var(--color-border-secondary)",
                    outline: "none"
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100"
                >
                  {showPassword ? (
                    <EyeOff size={16} style={{ color: "var(--color-text-tertiary)" }} />
                  ) : (
                    <Eye size={16} style={{ color: "var(--color-text-tertiary)" }} />
                  )}
                </button>
              </div>
            </div>

            <div className="flex justify-end">
              <Link to="/forgot-password" className="font-medium transition-colors" style={{ fontSize: "13px", color: "var(--color-teal-600)" }}>
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              disabled={isLoading || !hasSupabaseConfig}
              className="w-full py-3 rounded-lg font-medium transition-all"
              style={{
                fontSize: "14px",
                background: isLoading || !hasSupabaseConfig ? "var(--color-text-tertiary)" : "var(--color-teal-600)",
                color: "white",
                cursor: isLoading || !hasSupabaseConfig ? "not-allowed" : "pointer"
              }}
            >
              {isLoading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <p className="text-center mt-8" style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
            Don&apos;t have an account?{" "}
            <Link to="/signup" className="font-medium transition-colors" style={{ color: "var(--color-teal-600)" }}>
              Sign up
            </Link>
          </p>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center p-12" style={{ background: "var(--color-teal-600)" }}>
        <div className="max-w-lg text-white">
          <h2 className="font-semibold mb-6" style={{ fontSize: "36px" }}>
            Build your perfect resume in minutes
          </h2>
          <p className="mb-8" style={{ fontSize: "16px", lineHeight: "1.6", opacity: 0.9 }}>
            Create job-specific resumes with AI assistance, track your applications,
            and land your next role faster.
          </p>
        </div>
      </div>
    </div>
  );
}

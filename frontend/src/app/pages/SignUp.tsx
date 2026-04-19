import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Mail, Lock, User, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../integration/auth-context";
import { hasSupabaseConfig } from "../integration/config";

export function SignUp() {
  const navigate = useNavigate();
  const { signUp } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);
    setIsLoading(true);

    try {
      const result = await signUp(name, email, password);
      if (result.needsEmailVerification) {
        setSuccessMessage(
          "Account created. Check your email to confirm your account, then sign in."
        );
      } else {
        navigate("/app", { replace: true });
      }
    } catch (error) {
      if (error instanceof Error) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage("Sign-up failed. Please try again.");
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
              Create your account
            </h1>
            <p style={{ fontSize: "15px", color: "var(--color-text-secondary)" }}>
              Start building professional resumes in minutes
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

          {successMessage && (
            <div
              className="mb-5 p-3 rounded-lg border"
              style={{
                borderColor: "var(--color-teal-200)",
                background: "var(--color-teal-50)",
                color: "var(--color-teal-800)",
                fontSize: "13px"
              }}
            >
              {successMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="name" className="block mb-2 font-medium" style={{ fontSize: "13px", color: "var(--color-text-primary)" }}>
                Full name
              </label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-text-tertiary)" }} />
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  required
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border"
                  style={{
                    fontSize: "14px",
                    borderColor: "var(--color-border-secondary)",
                    outline: "none"
                  }}
                />
              </div>
            </div>

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
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border"
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
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-100"
                >
                  {showPassword ? (
                    <EyeOff size={16} style={{ color: "var(--color-text-tertiary)" }} />
                  ) : (
                    <Eye size={16} style={{ color: "var(--color-text-tertiary)" }} />
                  )}
                </button>
              </div>
              <p className="mt-1.5" style={{ fontSize: "12px", color: "var(--color-text-tertiary)" }}>
                Must be at least 8 characters
              </p>
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
              {isLoading ? "Creating account..." : "Create account"}
            </button>
          </form>

          <p className="text-center mt-8" style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
            Already have an account?{" "}
            <Link to="/signin" className="font-medium transition-colors" style={{ color: "var(--color-teal-600)" }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>

      <div className="hidden lg:flex flex-1 items-center justify-center p-12" style={{ background: "var(--color-teal-600)" }}>
        <div className="max-w-lg text-white">
          <h2 className="font-semibold mb-6" style={{ fontSize: "36px" }}>
            Join thousands of job seekers
          </h2>
          <p className="mb-8" style={{ fontSize: "16px", lineHeight: "1.6", opacity: 0.9 }}>
            Create your account and start building professional resumes tailored for each role.
          </p>
        </div>
      </div>
    </div>
  );
}

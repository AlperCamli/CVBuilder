import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Mail, Lock, User, Eye, EyeOff } from "lucide-react";

export function SignUp() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      navigate("/app");
    }, 1000);
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Side - Sign Up Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 mb-12">
            <div
              className="w-8 h-8 rounded-md"
              style={{ background: "var(--color-teal-600)" }}
            />
            <span 
              className="font-semibold" 
              style={{ fontSize: "20px", color: "var(--color-text-primary)" }}
            >
              Resumé
            </span>
          </Link>

          {/* Header */}
          <div className="mb-8">
            <h1 
              className="font-semibold mb-2" 
              style={{ fontSize: "32px", color: "var(--color-text-primary)" }}
            >
              Create your account
            </h1>
            <p style={{ fontSize: "15px", color: "var(--color-text-secondary)" }}>
              Start building professional resumes in minutes
            </p>
          </div>

          {/* Sign Up Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Name Field */}
            <div>
              <label 
                htmlFor="name"
                className="block mb-2 font-medium"
                style={{ fontSize: "13px", color: "var(--color-text-primary)" }}
              >
                Full name
              </label>
              <div className="relative">
                <User 
                  size={16} 
                  className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--color-text-tertiary)" }}
                />
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Doe"
                  required
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg border transition-colors"
                  style={{
                    fontSize: "14px",
                    borderColor: "var(--color-border-secondary)",
                    outline: "none",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "var(--color-teal-600)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "var(--color-border-secondary)";
                  }}
                />
              </div>
            </div>

            {/* Email Field */}
            <div>
              <label 
                htmlFor="email"
                className="block mb-2 font-medium"
                style={{ fontSize: "13px", color: "var(--color-text-primary)" }}
              >
                Email address
              </label>
              <div className="relative">
                <Mail 
                  size={16} 
                  className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--color-text-tertiary)" }}
                />
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
                    outline: "none",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "var(--color-teal-600)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "var(--color-border-secondary)";
                  }}
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label 
                htmlFor="password"
                className="block mb-2 font-medium"
                style={{ fontSize: "13px", color: "var(--color-text-primary)" }}
              >
                Password
              </label>
              <div className="relative">
                <Lock 
                  size={16} 
                  className="absolute left-3 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--color-text-tertiary)" }}
                />
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  required
                  minLength={8}
                  className="w-full pl-10 pr-12 py-2.5 rounded-lg border transition-colors"
                  style={{
                    fontSize: "14px",
                    borderColor: "var(--color-border-secondary)",
                    outline: "none",
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = "var(--color-teal-600)";
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = "var(--color-border-secondary)";
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

            {/* Terms & Conditions */}
            <p style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>
              By creating an account, you agree to our{" "}
              <a
                href="#"
                className="font-medium"
                style={{ color: "var(--color-teal-600)" }}
              >
                Terms of Service
              </a>{" "}
              and{" "}
              <a
                href="#"
                className="font-medium"
                style={{ color: "var(--color-teal-600)" }}
              >
                Privacy Policy
              </a>
            </p>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-lg font-medium transition-all"
              style={{
                fontSize: "14px",
                background: isLoading ? "var(--color-text-tertiary)" : "var(--color-teal-600)",
                color: "white",
                cursor: isLoading ? "not-allowed" : "pointer",
              }}
            >
              {isLoading ? "Creating account..." : "Create account"}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-4 my-8">
            <div className="flex-1 h-px" style={{ background: "var(--color-border-tertiary)" }} />
            <span style={{ fontSize: "13px", color: "var(--color-text-tertiary)" }}>
              or continue with
            </span>
            <div className="flex-1 h-px" style={{ background: "var(--color-border-tertiary)" }} />
          </div>

          {/* Social Sign Up */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              className="flex items-center justify-center gap-2 py-2.5 rounded-lg border transition-all hover:bg-gray-50"
              style={{ 
                fontSize: "14px",
                borderColor: "var(--color-border-secondary)",
                color: "var(--color-text-primary)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
                <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707 0-.593.102-1.17.282-1.709V4.958H.957C.347 6.173 0 7.548 0 9c0 1.452.348 2.827.957 4.042l3.007-2.335z"/>
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
              </svg>
              Google
            </button>
            <button
              type="button"
              className="flex items-center justify-center gap-2 py-2.5 rounded-lg border transition-all hover:bg-gray-50"
              style={{ 
                fontSize: "14px",
                borderColor: "var(--color-border-secondary)",
                color: "var(--color-text-primary)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
              GitHub
            </button>
          </div>

          {/* Sign In Link */}
          <p className="text-center mt-8" style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
            Already have an account?{" "}
            <Link
              to="/signin"
              className="font-medium transition-colors"
              style={{ color: "var(--color-teal-600)" }}
            >
              Sign in
            </Link>
          </p>
        </div>
      </div>

      {/* Right Side - Branding */}
      <div 
        className="hidden lg:flex flex-1 items-center justify-center p-12"
        style={{ background: "var(--color-teal-600)" }}
      >
        <div className="max-w-lg text-white">
          <h2 className="font-semibold mb-6" style={{ fontSize: "36px" }}>
            Join thousands of job seekers
          </h2>
          <p className="mb-8" style={{ fontSize: "16px", lineHeight: "1.6", opacity: 0.9 }}>
            Create your account and start building professional resumes that get you noticed 
            by recruiters and hiring managers.
          </p>
          <div className="space-y-4">
            {[
              "Free master CV to get started",
              "AI-powered improvements",
              "Unlimited tailored versions",
              "Track all your applications"
            ].map((feature, index) => (
              <div key={index} className="flex items-center gap-3">
                <div 
                  className="w-5 h-5 rounded-full flex items-center justify-center"
                  style={{ background: "rgba(255, 255, 255, 0.2)" }}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M10 3L4.5 8.5L2 6"
                      stroke="white"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <span style={{ fontSize: "15px" }}>{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
import { useState } from "react";
import { Link } from "react-router";
import { Mail, ArrowLeft, CheckCircle } from "lucide-react";

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    // Simulate API call
    setTimeout(() => {
      setIsLoading(false);
      setIsSubmitted(true);
    }, 1000);
  };

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
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

          {/* Success Message */}
          <div 
            className="bg-white rounded-2xl p-8 text-center"
            style={{ border: "1px solid var(--color-border-tertiary)" }}
          >
            <div 
              className="w-16 h-16 rounded-full mx-auto mb-6 flex items-center justify-center"
              style={{ background: "var(--color-teal-50)" }}
            >
              <CheckCircle size={32} style={{ color: "var(--color-teal-600)" }} />
            </div>
            
            <h1 
              className="font-semibold mb-3" 
              style={{ fontSize: "24px", color: "var(--color-text-primary)" }}
            >
              Check your email
            </h1>
            
            <p className="mb-6" style={{ fontSize: "15px", color: "var(--color-text-secondary)", lineHeight: "1.6" }}>
              We've sent a password reset link to <strong>{email}</strong>. 
              Click the link in the email to reset your password.
            </p>

            <div 
              className="p-4 rounded-lg mb-6"
              style={{ background: "var(--color-background-secondary)" }}
            >
              <p style={{ fontSize: "13px", color: "var(--color-text-secondary)", lineHeight: "1.5" }}>
                Didn't receive the email? Check your spam folder or{" "}
                <button
                  onClick={() => setIsSubmitted(false)}
                  className="font-medium"
                  style={{ color: "var(--color-teal-600)" }}
                >
                  try again
                </button>
              </p>
            </div>

            <Link
              to="/signin"
              className="inline-flex items-center gap-2 font-medium transition-colors"
              style={{ fontSize: "14px", color: "var(--color-teal-600)" }}
            >
              <ArrowLeft size={16} />
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8" style={{ background: "var(--color-background-secondary)" }}>
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

        {/* Form Card */}
        <div 
          className="bg-white rounded-2xl p-8"
          style={{ border: "1px solid var(--color-border-tertiary)" }}
        >
          {/* Back Link */}
          <Link
            to="/signin"
            className="inline-flex items-center gap-2 mb-8 font-medium transition-colors"
            style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}
          >
            <ArrowLeft size={16} />
            Back to sign in
          </Link>

          {/* Header */}
          <div className="mb-8">
            <h1 
              className="font-semibold mb-2" 
              style={{ fontSize: "28px", color: "var(--color-text-primary)" }}
            >
              Forgot password?
            </h1>
            <p style={{ fontSize: "15px", color: "var(--color-text-secondary)", lineHeight: "1.6" }}>
              No worries, we'll send you reset instructions to your email address.
            </p>
          </div>

          {/* Reset Form */}
          <form onSubmit={handleSubmit} className="space-y-6">
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
              {isLoading ? "Sending..." : "Send reset link"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
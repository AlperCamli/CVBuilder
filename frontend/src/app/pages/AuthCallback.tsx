import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";

export function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Supabase handles the OAuth token exchange automatically via the URL hash.
    // The AuthProvider's onAuthStateChange listener will detect the new session.
    // We just need to wait briefly and redirect to /app.
    const timeout = setTimeout(() => {
      navigate("/app", { replace: true });
    }, 1500);

    return () => clearTimeout(timeout);
  }, [navigate]);

  return (
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ background: "var(--color-background-secondary)" }}
    >
      <div className="text-center">
        <Loader2
          size={32}
          className="animate-spin mx-auto mb-4"
          style={{ color: "var(--color-teal-600)" }}
        />
        <p style={{ fontSize: "14px", color: "var(--color-text-secondary)" }}>
          Completing sign-in...
        </p>
      </div>
    </div>
  );
}

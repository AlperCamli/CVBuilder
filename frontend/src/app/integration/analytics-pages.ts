export interface AnalyticsPage { path: string; title: string }

const SCREENS: Record<string, string> = {
  "/": "Landing", "/guided-journey": "Guided landing", "/pricing": "Pricing",
  "/guided-journey/pricing": "Guided pricing", "/onboarding": "Upload and onboarding",
  "/privacy": "Privacy notice", "/cookies": "Cookies and storage", "/career-advice": "Career advice",
  "/app": "Dashboard", "/app/onboarding": "Saving uploaded CV", "/app/create": "Create or upload",
  "/app/upload-processing": "Processing CV", "/app/cv-score": "CV score", "/app/ai-improving": "Improving CV",
  "/app/create-cv": "Create CV", "/app/medical": "Medical CV", "/app/job-tracker": "Job tracker",
  "/app/resumes": "CV library", "/app/cover-letters": "Cover letter library", "/app/pricing": "Account pricing",
  "/app/profile": "Account profile"
};
const AUTH_SCREENS: Record<string, string> = {"/signin": "Sign in", "/signup": "Sign up", "/forgot-password": "Password recovery", "/email-sent": "Email verification"};

// Never send route IDs, filenames, search/hash values, auth callbacks or titles
// derived from user content. Unknown paths receive a generic screen label.
export function analyticsPage(pathname: string): AnalyticsPage | null {
  const path = pathname.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  if (path === "/auth/callback" || path === "/reset-password") return null;
  if (SCREENS[path]) return {path, title: SCREENS[path]};
  if (AUTH_SCREENS[path]) return {path: `/screens/${path.slice(1)}`, title: AUTH_SCREENS[path]};
  for (const [prefix, screen, title] of [
    ["/app/cv/", "/app/cv/editor", "CV editor"],
    ["/app/tailor/", "/app/tailor", "Tailor CV"],
    ["/app/tailoring-flow/", "/app/tailoring-flow", "Tailoring flow"],
    ["/app/cover-letter/", "/app/cover-letter/editor", "Cover letter editor"]
  ]) if (path.startsWith(prefix)) return {path: screen, title};
  if (path.startsWith("/career-advice/")) return {path: path.split("/").length > 3 ? "/career-advice/article" : "/career-advice/category", title: "Career advice"};
  if (path.startsWith("/designs")) return {path: "/designs", title: "Design preview"};
  return {path: "/screens/other", title: "Other screen"};
}

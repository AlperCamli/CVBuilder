import { createBrowserRouter, Navigate } from "react-router";
import { SidebarProvider } from "./contexts/SidebarContext";
import { UpgradePromptProvider } from "./contexts/UpgradePromptContext";
import { Layout } from "./components/Layout";
import { CheckoutIntentResumer } from "./components/CheckoutIntentResumer";
import { PostAuthRedirectResumer } from "./components/PostAuthRedirectResumer";
import { Landing } from "./pages/Landing";
import { CareerAdvice } from "./pages/CareerAdvice";
import { CareerCategory } from "./pages/CareerCategory";
import { CareerArticle } from "./pages/CareerArticle";
import { SignIn } from "./pages/SignIn";
import { SignUp } from "./pages/SignUp";
import { ForgotPassword } from "./pages/ForgotPassword";
import { ResetPassword } from "./pages/ResetPassword";
import { EmailSent } from "./pages/EmailSent";
import { AuthCallback } from "./pages/AuthCallback";
import { Dashboard } from "./pages/Dashboard";
import { CreateOrUpload } from "./pages/CreateOrUpload";
import { UploadProcessing } from "./pages/UploadProcessing";
import { CVScore } from "./pages/CVScore";
import { AIImproving } from "./pages/AIImproving";
import { CVEditor } from "./pages/CVEditor";
import { TailorCV } from "./pages/TailorCV";
import { TailoringFlow } from "./pages/TailoringFlow";
import { JobTracker } from "./pages/JobTracker";
import { Resumes } from "./pages/Resumes";
import { CoverLetters } from "./pages/CoverLetters";
import { CoverLetterEditor } from "./pages/CoverLetterEditor";
import { Pricing } from "./pages/Pricing";
import { PublicPricing } from "./pages/PublicPricing";
import { Profile } from "./pages/Profile";
import { RedirectIfAuthenticated, RequireAuth } from "./integration/auth-route-guards";

function LayoutWrapper() {
  return (
    <SidebarProvider>
      <UpgradePromptProvider>
        <CheckoutIntentResumer />
        <PostAuthRedirectResumer />
        <Layout />
      </UpgradePromptProvider>
    </SidebarProvider>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Landing
  },
  {
    path: "/pricing",
    Component: PublicPricing
  },
  {
    path: "/medical",
    element: <Navigate to="/app/medical" replace />
  },
  {
    path: "/career-advice",
    Component: CareerAdvice
  },
  {
    path: "/career-advice/:categorySlug",
    Component: CareerCategory
  },
  {
    path: "/career-advice/:categorySlug/:articleSlug",
    Component: CareerArticle
  },
  {
    path: "/signin",
    element: (
      <RedirectIfAuthenticated>
        <SignIn />
      </RedirectIfAuthenticated>
    )
  },
  {
    path: "/signup",
    element: (
      <RedirectIfAuthenticated>
        <SignUp />
      </RedirectIfAuthenticated>
    )
  },
  {
    path: "/forgot-password",
    Component: ForgotPassword
  },
  {
    path: "/reset-password",
    Component: ResetPassword
  },
  {
    path: "/email-sent",
    Component: EmailSent
  },
  {
    path: "/auth/callback",
    Component: AuthCallback
  },
  {
    path: "/app",
    element: (
      <RequireAuth>
        <LayoutWrapper />
      </RequireAuth>
    ),
    children: [
      { index: true, Component: Dashboard },
      { path: "create", Component: CreateOrUpload },
      { path: "upload-processing", Component: UploadProcessing },
      { path: "cv-score", Component: CVScore },
      { path: "ai-improving", Component: AIImproving },
      { path: "create-cv", element: <Navigate to="/app/cv/master" replace /> },
      { path: "medical", element: <CVEditor forcedModuleType="medical_uk" forcedTitle="Medical CV" /> },
      { path: "cv/:id", Component: CVEditor },
      { path: "tailor/:id", Component: TailorCV },
      { path: "tailoring-flow/:id", Component: TailoringFlow },
      { path: "job-tracker", Component: JobTracker },
      { path: "resumes", Component: Resumes },
      { path: "cover-letters", Component: CoverLetters },
      { path: "cover-letter/:jobId", Component: CoverLetterEditor },
      { path: "pricing", Component: Pricing },
      { path: "profile", Component: Profile }
    ]
  }
]);

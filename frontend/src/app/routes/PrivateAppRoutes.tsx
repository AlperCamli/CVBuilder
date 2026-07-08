import { Navigate } from "react-router";
import { Toaster } from "sonner";
import { CheckoutIntentResumer } from "../components/CheckoutIntentResumer";
import { Layout } from "../components/Layout";
import { OnboardingChecklist } from "../components/OnboardingChecklist";
import { PostAuthRedirectResumer } from "../components/PostAuthRedirectResumer";
import { OnboardingProvider } from "../contexts/OnboardingContext";
import { SidebarProvider } from "../contexts/SidebarContext";
import { UpgradePromptProvider } from "../contexts/UpgradePromptContext";
import { AuthProvider } from "../integration/auth-context";
import { RequireAuth } from "../integration/auth-route-guards";
import { AIImproving } from "../pages/AIImproving";
import { CoverLetterEditor } from "../pages/CoverLetterEditor";
import { CoverLetters } from "../pages/CoverLetters";
import { CreateOrUpload } from "../pages/CreateOrUpload";
import { CVEditor } from "../pages/CVEditor";
import { CVScore } from "../pages/CVScore";
import { Dashboard } from "../pages/Dashboard";
import { JobTracker } from "../pages/JobTracker";
import { Pricing } from "../pages/Pricing";
import { Profile } from "../pages/Profile";
import { Resumes } from "../pages/Resumes";
import { TailorCV } from "../pages/TailorCV";
import { TailoringFlow } from "../pages/TailoringFlow";
import { UploadProcessing } from "../pages/UploadProcessing";

export function AppShellRoute() {
  return (
    <AuthProvider>
      <RequireAuth>
        <SidebarProvider>
          <UpgradePromptProvider>
            <OnboardingProvider>
              <CheckoutIntentResumer />
              <PostAuthRedirectResumer />
              <Layout />
              <OnboardingChecklist />
              <Toaster richColors position="top-right" />
            </OnboardingProvider>
          </UpgradePromptProvider>
        </SidebarProvider>
      </RequireAuth>
    </AuthProvider>
  );
}

export function DashboardRoute() {
  return <Dashboard />;
}

export function CreateOrUploadRoute() {
  return <CreateOrUpload />;
}

export function UploadProcessingRoute() {
  return <UploadProcessing />;
}

export function CVScoreRoute() {
  return <CVScore />;
}

export function AIImprovingRoute() {
  return <AIImproving />;
}

export function CreateCvRedirectRoute() {
  return <Navigate to="/app/cv/master" replace />;
}

export function MedicalCVRoute() {
  return <CVEditor forcedModuleType="medical_uk" forcedTitle="Medical CV" />;
}

export function CVEditorRoute() {
  return <CVEditor />;
}

export function TailorCVRoute() {
  return <TailorCV />;
}

export function TailoringFlowRoute() {
  return <TailoringFlow />;
}

export function JobTrackerRoute() {
  return <JobTracker />;
}

export function ResumesRoute() {
  return <Resumes />;
}

export function CoverLettersRoute() {
  return <CoverLetters />;
}

export function CoverLetterEditorRoute() {
  return <CoverLetterEditor />;
}

export function PricingRoute() {
  return <Pricing />;
}

export function ProfileRoute() {
  return <Profile />;
}

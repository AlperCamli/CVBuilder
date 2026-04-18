import { createBrowserRouter, Navigate } from "react-router";
import { SidebarProvider } from "./contexts/SidebarContext";
import { Layout } from "./components/Layout";
import { Landing } from "./pages/Landing";
import { SignIn } from "./pages/SignIn";
import { SignUp } from "./pages/SignUp";
import { ForgotPassword } from "./pages/ForgotPassword";
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
import { Profile } from "./pages/Profile";

// Wrapper component for Layout with SidebarProvider
function LayoutWrapper() {
  return (
    <SidebarProvider>
      <Layout />
    </SidebarProvider>
  );
}

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Landing,
  },
  {
    path: "/signin",
    Component: SignIn,
  },
  {
    path: "/signup",
    Component: SignUp,
  },
  {
    path: "/forgot-password",
    Component: ForgotPassword,
  },
  {
    path: "/app",
    Component: LayoutWrapper,
    children: [
      { index: true, Component: Dashboard },
      { path: "create", Component: CreateOrUpload },
      { path: "upload-processing", Component: UploadProcessing },
      { path: "cv-score", Component: CVScore },
      { path: "ai-improving", Component: AIImproving },
      { path: "create-cv", element: <Navigate to="/app/cv/master" replace /> },
      { path: "cv/:id", Component: CVEditor },
      { path: "tailor/:id", Component: TailorCV },
      { path: "tailoring-flow/:id", Component: TailoringFlow },
      { path: "job-tracker", Component: JobTracker },
      { path: "resumes", Component: Resumes },
      { path: "cover-letters", Component: CoverLetters },
      { path: "cover-letter/:jobId", Component: CoverLetterEditor },
      { path: "pricing", Component: Pricing },
      { path: "profile", Component: Profile },
    ],
  },
]);
import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Landing } from "./pages/Landing";
import { CareerAdvice } from "./pages/CareerAdvice";
import { CareerCategory } from "./pages/CareerCategory";
import { CareerArticle } from "./pages/CareerArticle";
import { PublicPricing } from "./pages/PublicPricing";
import { NotFound } from "./pages/NotFound";
import { RouteSeo } from "./seo/route-seo";

type LazyRoute = LazyExoticComponent<ComponentType>;

function lazyRoute(loader: () => Promise<{ default: ComponentType }>): LazyRoute {
  return lazy(loader);
}

function lazyElement(RouteComponent: LazyRoute) {
  return (
    <Suspense fallback={null}>
      <RouteComponent />
    </Suspense>
  );
}

const SignInRoute = lazyRoute(() =>
  import("./routes/AuthRoutes").then(({ SignInRoute }) => ({ default: SignInRoute }))
);
const SignUpRoute = lazyRoute(() =>
  import("./routes/AuthRoutes").then(({ SignUpRoute }) => ({ default: SignUpRoute }))
);
const ForgotPasswordRoute = lazyRoute(() =>
  import("./routes/AuthRoutes").then(({ ForgotPasswordRoute }) => ({ default: ForgotPasswordRoute }))
);
const ResetPasswordRoute = lazyRoute(() =>
  import("./routes/AuthRoutes").then(({ ResetPasswordRoute }) => ({ default: ResetPasswordRoute }))
);
const EmailSentRoute = lazyRoute(() =>
  import("./routes/AuthRoutes").then(({ EmailSentRoute }) => ({ default: EmailSentRoute }))
);
const AuthCallbackRoute = lazyRoute(() =>
  import("./routes/AuthRoutes").then(({ AuthCallbackRoute }) => ({ default: AuthCallbackRoute }))
);

const AppShellRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ AppShellRoute }) => ({ default: AppShellRoute }))
);
const DashboardRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ DashboardRoute }) => ({ default: DashboardRoute }))
);
const CreateOrUploadRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ CreateOrUploadRoute }) => ({ default: CreateOrUploadRoute }))
);
const UploadProcessingRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ UploadProcessingRoute }) => ({ default: UploadProcessingRoute }))
);
const CVScoreRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ CVScoreRoute }) => ({ default: CVScoreRoute }))
);
const AIImprovingRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ AIImprovingRoute }) => ({ default: AIImprovingRoute }))
);
const CreateCvRedirectRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ CreateCvRedirectRoute }) => ({ default: CreateCvRedirectRoute }))
);
const MedicalCVRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ MedicalCVRoute }) => ({ default: MedicalCVRoute }))
);
const CVEditorRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ CVEditorRoute }) => ({ default: CVEditorRoute }))
);
const TailorCVRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ TailorCVRoute }) => ({ default: TailorCVRoute }))
);
const TailoringFlowRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ TailoringFlowRoute }) => ({ default: TailoringFlowRoute }))
);
const JobTrackerRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ JobTrackerRoute }) => ({ default: JobTrackerRoute }))
);
const ResumesRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ ResumesRoute }) => ({ default: ResumesRoute }))
);
const CoverLettersRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ CoverLettersRoute }) => ({ default: CoverLettersRoute }))
);
const CoverLetterEditorRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ CoverLetterEditorRoute }) => ({ default: CoverLetterEditorRoute }))
);
const PricingRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ PricingRoute }) => ({ default: PricingRoute }))
);
const ProfileRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ ProfileRoute }) => ({ default: ProfileRoute }))
);

export function AppRoutes() {
  return (
    <BrowserRouter>
      <RouteSeo />
      <RouteElements />
    </BrowserRouter>
  );
}

export function RouteElements() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/pricing" element={<PublicPricing />} />
      <Route path="/medical" element={<Navigate to="/app/medical" replace />} />
      <Route path="/career-advice" element={<CareerAdvice />} />
      <Route path="/career-advice/:categorySlug" element={<CareerCategory />} />
      <Route path="/career-advice/:categorySlug/:articleSlug" element={<CareerArticle />} />
      <Route path="/signin" element={lazyElement(SignInRoute)} />
      <Route path="/signup" element={lazyElement(SignUpRoute)} />
      <Route path="/forgot-password" element={lazyElement(ForgotPasswordRoute)} />
      <Route path="/reset-password" element={lazyElement(ResetPasswordRoute)} />
      <Route path="/email-sent" element={lazyElement(EmailSentRoute)} />
      <Route path="/auth/callback" element={lazyElement(AuthCallbackRoute)} />

      <Route path="/app" element={lazyElement(AppShellRoute)}>
        <Route index element={lazyElement(DashboardRoute)} />
        <Route path="create" element={lazyElement(CreateOrUploadRoute)} />
        <Route path="upload-processing" element={lazyElement(UploadProcessingRoute)} />
        <Route path="cv-score" element={lazyElement(CVScoreRoute)} />
        <Route path="ai-improving" element={lazyElement(AIImprovingRoute)} />
        <Route path="create-cv" element={lazyElement(CreateCvRedirectRoute)} />
        <Route path="medical" element={lazyElement(MedicalCVRoute)} />
        <Route path="cv/:id" element={lazyElement(CVEditorRoute)} />
        <Route path="tailor/:id" element={lazyElement(TailorCVRoute)} />
        <Route path="tailoring-flow/:id" element={lazyElement(TailoringFlowRoute)} />
        <Route path="job-tracker" element={lazyElement(JobTrackerRoute)} />
        <Route path="resumes" element={lazyElement(ResumesRoute)} />
        <Route path="cover-letters" element={lazyElement(CoverLettersRoute)} />
        <Route path="cover-letter/:jobId" element={lazyElement(CoverLetterEditorRoute)} />
        <Route path="pricing" element={lazyElement(PricingRoute)} />
        <Route path="profile" element={lazyElement(ProfileRoute)} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

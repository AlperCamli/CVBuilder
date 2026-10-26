import { LanguageChooser } from "./localization/LanguageControls";
import { PrivacyControls } from "./components/PrivacyControls";
import { AnalyticsNavigation } from "./components/AnalyticsNavigation";
import {
  lazy,
  Suspense,
  type ComponentType,
  type LazyExoticComponent,
} from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router";
import { CareerAdvice } from "./pages/CareerAdvice";
import { CareerCategory } from "./pages/CareerCategory";
import { CareerArticle } from "./pages/CareerArticle";
import Support from "./pages/Support";
import { NotFound } from "./pages/NotFound";
import { RouteSeo } from "./seo/route-seo";
import { DESIGN_TOOLS_ENABLED } from "./design-tools";

type LazyRoute = LazyExoticComponent<ComponentType>;

function lazyRoute(
  loader: () => Promise<{ default: ComponentType }>,
): LazyRoute {
  return lazy(loader);
}

function lazyElement(RouteComponent: LazyRoute | ComponentType) {
  return (
    <Suspense fallback={null}>
      <RouteComponent />
    </Suspense>
  );
}

const SignInRoute = lazyRoute(() =>
  import("./routes/AuthRoutes").then(({ SignInRoute }) => ({
    default: SignInRoute,
  })),
);
const PrivacyNoticeRoute = lazyRoute(() => import("./pages/PrivacyNotice"));
const GuidedJourneyRoute = lazyRoute(() => import("./pages/GuidedJourneyPage"));
const OnboardingRoute = lazyRoute(() => import("./pages/PreSignupOnboarding"));
const OnboardingResumeRoute = lazyRoute(() => import("./pages/OnboardingResume").then(({ OnboardingResume }) => ({ default: OnboardingResume })));
const MascotStudioRoute = DESIGN_TOOLS_ENABLED
  ? lazyRoute(() => import("./pages/designs/MascotStudio"))
  : null;
const LanguageStudioRoute = DESIGN_TOOLS_ENABLED
  ? lazyRoute(() => import("./pages/designs/LanguageStudio"))
  : null;
const DesignExplorationsRoute = DESIGN_TOOLS_ENABLED
  ? lazyRoute(() => import("./pages/designs/DesignRoutes"))
  : null;
const TemplateOrderStudioRoute = DESIGN_TOOLS_ENABLED
  ? lazyRoute(() => import("./pages/designs/TemplateOrderStudio"))
  : null;
const TemplateExplorationsRoute = DESIGN_TOOLS_ENABLED
  ? lazyRoute(() => import("./pages/designs/TemplateExplorations"))
  : null;
const SignUpRoute = lazyRoute(() =>
  import("./routes/AuthRoutes").then(({ SignUpRoute }) => ({
    default: SignUpRoute,
  })),
);
const ForgotPasswordRoute = lazyRoute(() =>
  import("./routes/AuthRoutes").then(({ ForgotPasswordRoute }) => ({
    default: ForgotPasswordRoute,
  })),
);
const ResetPasswordRoute = lazyRoute(() =>
  import("./routes/AuthRoutes").then(({ ResetPasswordRoute }) => ({
    default: ResetPasswordRoute,
  })),
);
const EmailSentRoute = lazyRoute(() =>
  import("./routes/AuthRoutes").then(({ EmailSentRoute }) => ({
    default: EmailSentRoute,
  })),
);
const AuthCallbackRoute = lazyRoute(() =>
  import("./routes/AuthRoutes").then(({ AuthCallbackRoute }) => ({
    default: AuthCallbackRoute,
  })),
);

const AppShellRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ AppShellRoute }) => ({
    default: AppShellRoute,
  })),
);
const DashboardRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ DashboardRoute }) => ({
    default: DashboardRoute,
  })),
);
const CheckoutRoute = lazyRoute(() => import("./routes/PrivateAppRoutes").then(({ CheckoutRoute }) => ({ default: CheckoutRoute })));
const CreateOrUploadRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ CreateOrUploadRoute }) => ({
    default: CreateOrUploadRoute,
  })),
);
const UploadProcessingRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ UploadProcessingRoute }) => ({
    default: UploadProcessingRoute,
  })),
);
const CVScoreRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ CVScoreRoute }) => ({
    default: CVScoreRoute,
  })),
);
const AIImprovingRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ AIImprovingRoute }) => ({
    default: AIImprovingRoute,
  })),
);
const CreateCvRedirectRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ CreateCvRedirectRoute }) => ({
    default: CreateCvRedirectRoute,
  })),
);
const MedicalCVRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ MedicalCVRoute }) => ({
    default: MedicalCVRoute,
  })),
);
const CVEditorRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ CVEditorRoute }) => ({
    default: CVEditorRoute,
  })),
);
const TailorCVRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ TailorCVRoute }) => ({
    default: TailorCVRoute,
  })),
);
const TailorRedirectRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ TailorRedirectRoute }) => ({
    default: TailorRedirectRoute,
  })),
);
const AdminTailoringCostsRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ AdminTailoringCostsRoute }) => ({
    default: AdminTailoringCostsRoute,
  })),
);
const TailoringFlowRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ TailoringFlowRoute }) => ({
    default: TailoringFlowRoute,
  })),
);
const JobTrackerRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ JobTrackerRoute }) => ({
    default: JobTrackerRoute,
  })),
);
const ResumesRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ ResumesRoute }) => ({
    default: ResumesRoute,
  })),
);
const CoverLettersRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ CoverLettersRoute }) => ({
    default: CoverLettersRoute,
  })),
);
const CoverLetterEditorRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ CoverLetterEditorRoute }) => ({
    default: CoverLetterEditorRoute,
  })),
);
const PricingRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ PricingRoute }) => ({
    default: PricingRoute,
  })),
);
const ProfileRoute = lazyRoute(() =>
  import("./routes/PrivateAppRoutes").then(({ ProfileRoute }) => ({
    default: ProfileRoute,
  })),
);

export function AppRoutes({ guidedJourney }: { guidedJourney?: ComponentType } = {}) {
  return (
    <BrowserRouter>
      <RouteContents guidedJourney={guidedJourney} />
    </BrowserRouter>
  );
}

// Keep the same sibling order and useId tree for prerendering and hydration.
export function RouteContents({ guidedJourney }: { guidedJourney?: ComponentType } = {}) {
  const { pathname } = useLocation();
  const reviewTool = DESIGN_TOOLS_ENABLED && (
    /^\/designs\/guided-journey\/(editor|languages)\/?$/.test(pathname) ||
    /^\/designs\/template-order\/?$/.test(pathname)
  );
  return (
    <>
      {!reviewTool && <LanguageChooser />}
      {!reviewTool && <AnalyticsNavigation />}
      <RouteSeo />
      <RouteElements guidedJourney={guidedJourney} />
      {!reviewTool && <PrivacyControls />}
    </>
  );
}

export function RouteElements({
  guidedJourney = GuidedJourneyRoute,
}: { guidedJourney?: ComponentType } = {}) {
  return (
    <Routes>
      <Route path="/support" element={<Support />} />
      <Route path="/tr/support" element={<Support />} />
      <Route path="/privacy" element={lazyElement(PrivacyNoticeRoute)} />
      <Route path="/cookies" element={lazyElement(PrivacyNoticeRoute)} />
      <Route path="/" element={lazyElement(guidedJourney)} />
      <Route path="/tr" element={lazyElement(guidedJourney)} />
      <Route path="/tr/pricing" element={lazyElement(guidedJourney)} />
      <Route path="/onboarding" element={lazyElement(OnboardingRoute)} />
      <Route path="/pricing" element={lazyElement(guidedJourney)} />
      <Route path="/guided-journey" element={lazyElement(guidedJourney)} />
      <Route
        path="/guided-journey/pricing"
        element={lazyElement(guidedJourney)}
      />
      {MascotStudioRoute && (
        <Route
          path="/designs/guided-journey/editor"
          element={lazyElement(MascotStudioRoute)}
        />
      )}
      {LanguageStudioRoute && (
        <Route path="/designs/guided-journey/languages" element={lazyElement(LanguageStudioRoute)} />
      )}
      {TemplateOrderStudioRoute && (
        <Route path="/designs/template-order" element={lazyElement(TemplateOrderStudioRoute)} />
      )}
      {TemplateExplorationsRoute && (
        <Route path="/designs/guided-journey/templates/:presentation" element={lazyElement(TemplateExplorationsRoute)} />
      )}
      {DesignExplorationsRoute && (
        <>
          <Route
            path="/designs"
            element={lazyElement(DesignExplorationsRoute)}
          />
          <Route
            path="/designs/:concept"
            element={lazyElement(DesignExplorationsRoute)}
          />
          <Route
            path="/designs/:concept/pricing"
            element={lazyElement(DesignExplorationsRoute)}
          />
        </>
      )}
      <Route path="/medical" element={<Navigate to="/app/medical" replace />} />
      <Route path="/career-advice" element={<CareerAdvice />} />
      <Route path="/career-advice/:categorySlug" element={<CareerCategory />} />
      <Route
        path="/career-advice/:categorySlug/:articleSlug"
        element={<CareerArticle />}
      />
      <Route path="/signin" element={lazyElement(SignInRoute)} />
      <Route path="/signup" element={lazyElement(SignUpRoute)} />
      <Route
        path="/forgot-password"
        element={lazyElement(ForgotPasswordRoute)}
      />
      <Route path="/reset-password" element={lazyElement(ResetPasswordRoute)} />
      <Route path="/email-sent" element={lazyElement(EmailSentRoute)} />
      <Route path="/auth/callback" element={lazyElement(AuthCallbackRoute)} />

      <Route path="/app" element={lazyElement(AppShellRoute)}>
        <Route index element={lazyElement(DashboardRoute)} />
        <Route path="checkout" element={lazyElement(CheckoutRoute)} />
        <Route path="onboarding" element={lazyElement(OnboardingResumeRoute)} />
        <Route path="create" element={lazyElement(CreateOrUploadRoute)} />
        <Route
          path="upload-processing"
          element={lazyElement(UploadProcessingRoute)}
        />
        <Route path="cv-score" element={lazyElement(CVScoreRoute)} />
        <Route path="ai-improving" element={lazyElement(AIImprovingRoute)} />
        <Route path="create-cv" element={lazyElement(CreateCvRedirectRoute)} />
        <Route path="medical" element={lazyElement(MedicalCVRoute)} />
        <Route path="cv/:id" element={lazyElement(CVEditorRoute)} />
        <Route path="tailor/:id" element={lazyElement(TailorRedirectRoute)} />
        {/* Legacy page-based tailoring, kept until tailoring v2 has fully replaced it. */}
        <Route path="tailor-legacy/:id" element={lazyElement(TailorCVRoute)} />
        <Route path="admin/tailoring" element={lazyElement(AdminTailoringCostsRoute)} />
        <Route
          path="tailoring-flow/:id"
          element={lazyElement(TailoringFlowRoute)}
        />
        <Route path="job-tracker" element={lazyElement(JobTrackerRoute)} />
        <Route path="resumes" element={lazyElement(ResumesRoute)} />
        <Route path="cover-letters" element={lazyElement(CoverLettersRoute)} />
        <Route
          path="cover-letter/:jobId"
          element={lazyElement(CoverLetterEditorRoute)}
        />
        <Route path="pricing" element={lazyElement(PricingRoute)} />
        <Route path="profile" element={lazyElement(ProfileRoute)} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

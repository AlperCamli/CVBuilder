import { type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { LanguageSwitcher } from "../localization/LanguageControls";
import { Toaster } from "sonner";
import { AuthProvider } from "../integration/auth-context";
import { RedirectIfAuthenticated } from "../integration/auth-route-guards";
import { signupOnboardingRedirect } from "../integration/entry-onboarding";
import { AuthCallback } from "../pages/AuthCallback";
import { EmailSent } from "../pages/EmailSent";
import { ForgotPassword } from "../pages/ForgotPassword";
import { ResetPassword } from "../pages/ResetPassword";
import { SignIn } from "../pages/SignIn";
import { SignUp } from "../pages/SignUp";

function AuthFrame({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <AuthProvider>
      {pathname !== "/auth/callback" && <div className="absolute top-4 right-4 z-20"><LanguageSwitcher /></div>}
      {children}
      <Toaster richColors position="top-right" />
    </AuthProvider>
  );
}

export function SignInRoute() {
  return (
    <AuthFrame>
      <RedirectIfAuthenticated>
        <SignIn />
      </RedirectIfAuthenticated>
    </AuthFrame>
  );
}

function SignUpEntry() {
  const { state, search } = useLocation();
  const onboarding = signupOnboardingRedirect(state, search);
  return onboarding ? <Navigate to={onboarding} replace /> : <SignUp />;
}

export function SignUpRoute() {
  return (
    <AuthFrame>
      <RedirectIfAuthenticated>
        <SignUpEntry />
      </RedirectIfAuthenticated>
    </AuthFrame>
  );
}

export function ForgotPasswordRoute() {
  return (
    <AuthFrame>
      <ForgotPassword />
    </AuthFrame>
  );
}

export function ResetPasswordRoute() {
  return (
    <AuthFrame>
      <ResetPassword />
    </AuthFrame>
  );
}

export function EmailSentRoute() {
  return (
    <AuthFrame>
      <EmailSent />
    </AuthFrame>
  );
}

export function AuthCallbackRoute() {
  return (
    <AuthFrame>
      <AuthCallback />
    </AuthFrame>
  );
}

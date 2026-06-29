import { type ReactNode } from "react";
import { Toaster } from "sonner";
import { AuthProvider } from "../integration/auth-context";
import { RedirectIfAuthenticated } from "../integration/auth-route-guards";
import { AuthCallback } from "../pages/AuthCallback";
import { EmailSent } from "../pages/EmailSent";
import { ForgotPassword } from "../pages/ForgotPassword";
import { ResetPassword } from "../pages/ResetPassword";
import { SignIn } from "../pages/SignIn";
import { SignUp } from "../pages/SignUp";

function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
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

export function SignUpRoute() {
  return (
    <AuthFrame>
      <RedirectIfAuthenticated>
        <SignUp />
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

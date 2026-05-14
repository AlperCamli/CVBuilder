type AuthFlow =
  | "sign_in"
  | "sign_up"
  | "forgot_password"
  | "reset_password"
  | "google_oauth";

interface AuthErrorDetails {
  message: string;
  code: string;
  status: number | null;
}

const toAuthErrorDetails = (error: unknown): AuthErrorDetails => {
  if (!error || typeof error !== "object") {
    return { message: "", code: "", status: null };
  }

  const maybeError = error as {
    message?: unknown;
    code?: unknown;
    status?: unknown;
  };

  return {
    message: typeof maybeError.message === "string" ? maybeError.message : "",
    code: typeof maybeError.code === "string" ? maybeError.code : "",
    status: typeof maybeError.status === "number" ? maybeError.status : null
  };
};

const includesAny = (value: string, patterns: string[]): boolean =>
  patterns.some((pattern) => value.includes(pattern));

const isNetworkError = (details: AuthErrorDetails): boolean => {
  const text = `${details.message} ${details.code}`.toLowerCase();
  return includesAny(text, [
    "network",
    "failed to fetch",
    "fetch failed",
    "timeout",
    "connection"
  ]);
};

const isRateLimitError = (details: AuthErrorDetails): boolean => {
  const text = `${details.message} ${details.code}`.toLowerCase();
  return details.status === 429 || includesAny(text, ["rate limit", "too many requests"]);
};

const isInvalidCredentialError = (details: AuthErrorDetails): boolean => {
  const text = `${details.message} ${details.code}`.toLowerCase();
  return includesAny(text, [
    "invalid login credentials",
    "invalid credentials",
    "email not confirmed",
    "email_not_confirmed",
    "invalid_grant"
  ]);
};

const isWeakPasswordError = (details: AuthErrorDetails): boolean => {
  const text = `${details.message} ${details.code}`.toLowerCase();
  return includesAny(text, [
    "password should be",
    "password is too weak",
    "weak password",
    "same password",
    "new password should"
  ]);
};

const isExpiredOrInvalidRecoveryLink = (details: AuthErrorDetails): boolean => {
  const text = `${details.message} ${details.code}`.toLowerCase();
  return includesAny(text, [
    "invalid flow state",
    "flow state",
    "expired",
    "token has expired",
    "invalid token",
    "otp expired",
    "session missing",
    "auth session missing"
  ]);
};

export const mapAuthErrorMessage = (flow: AuthFlow, error: unknown): string => {
  const details = toAuthErrorDetails(error);

  if (isNetworkError(details)) {
    return "Network error. Please check your connection and try again.";
  }

  if (isRateLimitError(details)) {
    return "Too many attempts. Please wait a moment and try again.";
  }

  if (flow === "sign_in") {
    if (isInvalidCredentialError(details)) {
      return "Invalid email or password.";
    }
    return "Sign-in failed. Please try again.";
  }

  if (flow === "sign_up") {
    if (isWeakPasswordError(details)) {
      return "Your password does not meet security requirements.";
    }
    return "Unable to create account right now. Please try again.";
  }

  if (flow === "forgot_password") {
    return "If an account exists for that email, reset instructions will be sent.";
  }

  if (flow === "reset_password") {
    if (isWeakPasswordError(details)) {
      return "Your new password does not meet security requirements.";
    }
    if (isExpiredOrInvalidRecoveryLink(details)) {
      return "This password reset link is invalid or has expired. Request a new reset link.";
    }
    return "Unable to update password right now. Please try again.";
  }

  return "Authentication failed. Please try again.";
};


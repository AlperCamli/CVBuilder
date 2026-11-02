import type { ReactNode } from "react";

// Every signed-in account uses the app: the manual workspace, one free tailoring session and one
// free "Improve with AI" need no subscription. Gated actions (exports, other AI, further tailoring)
// open the trial prompt where they happen, and the backend enforces the same rules.
export function SubscriptionGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

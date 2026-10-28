import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, ShieldX } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ApiError, useMe, type Me } from "@/lib/api";
import { hasSupabaseConfig } from "@/lib/config";
import { supabase } from "@/lib/supabase";

interface AuthContextValue {
  session: Session;
  me: Me;
  email: string;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside <AuthGate>");
  return value;
}

function useSession() {
  // undefined = still restoring the stored session (or parsing the OAuth redirect).
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => active && setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return session;
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-xl border bg-card p-6 text-center">{children}</div>
    </main>
  );
}

function SignInScreen({ notice }: { notice: string | null }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const signIn = async () => {
    setPending(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${window.location.pathname}${window.location.search}` },
    });
    if (authError) {
      setError(authError.message);
      setPending(false);
    }
  };
  return (
    <Screen>
      <h1 className="text-lg font-semibold">CV Builder Admin</h1>
      <p className="text-sm text-muted-foreground">Sign in with your team Google account.</p>
      {notice && (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm">
          {notice}
        </p>
      )}
      {hasSupabaseConfig ? (
        <Button onClick={signIn} disabled={pending} className="w-full">
          {pending && <Loader2 className="animate-spin" />} Sign in with Google
        </Button>
      ) : (
        <p role="alert" className="text-sm text-delta-bad">
          Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-delta-bad">{error}</p>}
    </Screen>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const me = useMe(session?.user.id);

  const [notice, setNotice] = useState<string | null>(null);

  // Local scope: a global sign-out would also end the admin's product sessions on every device.
  const endSession = useCallback(async () => {
    await supabase.auth.signOut({ scope: "local" });
    queryClient.clear();
  }, [queryClient]);
  const signOut = useCallback(async () => {
    setNotice(null);
    await endSession();
  }, [endSession]);

  const unauthorized = me.error instanceof ApiError && me.error.status === 401;
  useEffect(() => {
    if (!unauthorized) return;
    setNotice("You were signed out because your session expired or was rejected. Please sign in again.");
    void endSession();
  }, [unauthorized, endSession]);

  const checking = (
    <Screen>
      <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground">Checking access…</p>
    </Screen>
  );
  if (session === undefined || unauthorized) return checking;
  if (!session) return <SignInScreen notice={notice} />;

  const email = me.data?.email ?? session.user.email ?? "unknown account";
  const signOutButton = (
    <Button variant="outline" onClick={signOut}>
      <LogOut /> Sign out
    </Button>
  );

  if (me.isError) {
    return (
      <Screen>
        <h1 className="text-lg font-semibold">Could not verify access</h1>
        <p className="text-sm text-muted-foreground">{me.error.message}</p>
        <div className="flex gap-2">
          <Button onClick={() => me.refetch()}>Retry</Button>
          {signOutButton}
        </div>
      </Screen>
    );
  }
  if (!me.data) return checking;
  if (!me.data.is_admin) {
    return (
      <Screen>
        <ShieldX className="size-6 text-delta-bad" aria-hidden="true" />
        <h1 className="text-lg font-semibold">No access</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{email}</span> is not an admin account.
        </p>
        {signOutButton}
      </Screen>
    );
  }

  return <AuthContext.Provider value={{ session, me: me.data, email, signOut }}>{children}</AuthContext.Provider>;
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import type { Session } from "@supabase/supabase-js";
import { createApiClient } from "./api-client";
import { ApiClientError } from "./api-error";
import type { MeResponseData } from "./api-types";
import { BackendApi } from "./backend-api";
import { ensureSupabaseConfigured, integrationConfig } from "./config";
import { supabase } from "./supabase-client";

interface SignUpResult {
  needsEmailVerification: boolean;
}

interface AuthContextValue {
  session: Session | null;
  me: MeResponseData | null;
  api: BackendApi;
  initialized: boolean;
  loadingMe: boolean;
  isAuthenticated: boolean;
  authMessage: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (fullName: string, email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<MeResponseData | null>;
  clearAuthMessage: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<MeResponseData | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [loadingMe, setLoadingMe] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const unauthorizedHandledRef = useRef(false);

  const handleUnauthorized = useCallback((error: ApiClientError) => {
    if (unauthorizedHandledRef.current) {
      return;
    }

    unauthorizedHandledRef.current = true;
    setAuthMessage(
      error.message || "Your session expired. Please sign in again to continue."
    );
    setMe(null);

    void supabase.auth.signOut();
  }, []);

  const api = useMemo(() => {
    const apiClient = createApiClient({
      baseUrl: integrationConfig.apiBaseUrl,
      getAccessToken: async () => {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      },
      onUnauthorized: handleUnauthorized
    });

    return new BackendApi(apiClient);
  }, [handleUnauthorized]);

  const refreshMe = useCallback(async (): Promise<MeResponseData | null> => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setMe(null);
      return null;
    }

    setLoadingMe(true);
    try {
      const meResponse = await api.getMe();
      setMe(meResponse);
      return meResponse;
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (!error.isUnauthorized) {
          setAuthMessage(error.message);
        }
      } else if (error instanceof Error) {
        setAuthMessage(error.message);
      } else {
        setAuthMessage("Failed to load account context.");
      }

      setMe(null);
      return null;
    } finally {
      setLoadingMe(false);
    }
  }, [api]);

  const signIn = useCallback(
    async (email: string, password: string): Promise<void> => {
      ensureSupabaseConfigured();
      setAuthMessage(null);

      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        throw error;
      }

      await refreshMe();
    },
    [refreshMe]
  );

  const signUp = useCallback(
    async (fullName: string, email: string, password: string): Promise<SignUpResult> => {
      ensureSupabaseConfigured();
      setAuthMessage(null);

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName
          }
        }
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        await refreshMe();
      }

      return {
        needsEmailVerification: !data.session
      };
    },
    [refreshMe]
  );

  const signOut = useCallback(async () => {
    setAuthMessage(null);
    setMe(null);
    unauthorizedHandledRef.current = false;
    await supabase.auth.signOut();
  }, []);

  const clearAuthMessage = useCallback(() => {
    setAuthMessage(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (cancelled) {
        return;
      }

      if (error) {
        setAuthMessage(error.message);
        setSession(null);
        setMe(null);
        setInitialized(true);
        return;
      }

      setSession(data.session);

      if (data.session) {
        await refreshMe();
      } else {
        setMe(null);
      }

      setInitialized(true);
    };

    void bootstrap();

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      unauthorizedHandledRef.current = false;
      setSession(nextSession);

      if (!nextSession) {
        setMe(null);
        return;
      }

      void refreshMe();
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [refreshMe]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      me,
      api,
      initialized,
      loadingMe,
      isAuthenticated: Boolean(session),
      authMessage,
      signIn,
      signUp,
      signOut,
      refreshMe,
      clearAuthMessage
    }),
    [
      session,
      me,
      api,
      initialized,
      loadingMe,
      authMessage,
      signIn,
      signUp,
      signOut,
      refreshMe,
      clearAuthMessage
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};

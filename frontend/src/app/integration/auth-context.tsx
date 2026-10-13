import { translate as t } from "../localization/i18n";
import { useTranslation } from "react-i18next";
import { chooseLocale, i18n, readLocale, pendingLocale, clearPendingLocale } from "../localization/i18n";
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
import { ACCOUNT_READY_EVENT } from "./privacy";
import { getStudioRuntime } from "./studio-runtime";

interface SignUpResult {
  needsEmailVerification: boolean;
}

export interface AuthContextValue {
  session: Session | null;
  me: MeResponseData | null;
  api: BackendApi;
  initialized: boolean;
  loadingMe: boolean;
  isAuthenticated: boolean;
  authMessage: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (fullName: string, email: string, password: string) => Promise<SignUpResult>;
  signInWithGoogle: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshMe: () => Promise<MeResponseData | null>;
  clearAuthMessage: () => void;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const DemoProvider = getStudioRuntime()?.AuthProvider;
  return DemoProvider ? <DemoProvider>{children}</DemoProvider> : <AccountAuthProvider>{children}</AccountAuthProvider>;
};

const AccountAuthProvider = ({ children }: { children: ReactNode }) => {
  useTranslation();
  const [session, setSession] = useState<Session | null>(null);
  const [me, setMe] = useState<MeResponseData | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [loadingMe, setLoadingMe] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const unauthorizedHandledRef = useRef(false);
  const localeSyncRef = useRef<Promise<void>>(Promise.resolve());
  const localeSyncCountRef = useRef(0);
  const localeRevisionRef = useRef(0);

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

  const syncLocale = useCallback((locale: "en" | "tr") => {
    localeSyncCountRef.current++;
    const work = localeSyncRef.current.catch(() => {}).then(async () => {
      await api.patchSettings({ locale });
      const result = await supabase.auth.updateUser({ data: { locale } });
      if (result.error) throw result.error;
      // A newer switch may have been queued while this request was running.
      if (pendingLocale() === locale) clearPendingLocale();
    }).finally(() => { localeSyncCountRef.current--; });
    localeSyncRef.current = work;
    return work;
  }, [api]);

  const refreshMe = useCallback(async (): Promise<MeResponseData | null> => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setMe(null);
      return null;
    }

    setLoadingMe(true);
    const localeRevision = localeRevisionRef.current;
    const wasSyncingLocale = localeSyncCountRef.current > 0;
    try {
      const meResponse = await api.getMe();
      const locale = pendingLocale();
      if (locale) {
        try {
          await syncLocale(locale);
          meResponse.user = { ...meResponse.user, locale: readLocale() ?? locale };
        } catch { setAuthMessage(t("Could not save language preference. Please retry.")); }
      } else if (!wasSyncingLocale && localeSyncCountRef.current === 0 && localeRevision === localeRevisionRef.current) chooseLocale(meResponse.user.locale, false);
      setMe(meResponse);

      window.dispatchEvent(new Event(ACCOUNT_READY_EVENT));
      return meResponse;
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (!error.isUnauthorized) {
          setAuthMessage(error.message);
        }
      } else if (error instanceof Error) {
        setAuthMessage(error.message);
      } else {
        setAuthMessage(t("Failed to load account context."));
      }

      setMe(null);
      return null;
    } finally {
      setLoadingMe(false);
    }
  }, [api, syncLocale]);

  useEffect(() => {
    const persist = () => {
      const locale = pendingLocale();
      if (!locale) return;
      localeRevisionRef.current++;
      if (session) void syncLocale(locale).catch(() => setAuthMessage(t("Could not save language preference. Please retry.")));
    };
    window.addEventListener("cv-locale-changed", persist);
    return () => window.removeEventListener("cv-locale-changed", persist);
  }, [syncLocale, session]);

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
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            locale: i18n.language,
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

  const signInWithGoogle = useCallback(async () => {
    ensureSupabaseConfigured();
    setAuthMessage(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`
      }
    });

    if (error) {
      throw error;
    }
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    ensureSupabaseConfigured();
    setAuthMessage(null);

    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      throw error;
    }
  }, []);

  const updatePassword = useCallback(async (password: string) => {
    ensureSupabaseConfigured();
    setAuthMessage(null);

    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      throw error;
    }
  }, []);

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
      signInWithGoogle,
      requestPasswordReset,
      updatePassword,
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
      signInWithGoogle,
      requestPasswordReset,
      updatePassword,
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

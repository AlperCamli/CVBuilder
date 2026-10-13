import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { toast } from "sonner";
import {
  AuthContext,
  type AuthContextValue,
} from "../../integration/auth-context";
import { BackendApi } from "../../integration/backend-api";
import {
  installStudioRuntime,
  isStudioPreviewFrame,
} from "../../integration/studio-runtime";
import { translate as t } from "../i18n";
import { createDemoStore, type DemoState } from "./demo-data";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(String(key)) ?? null,
    setItem: (key, value) => {
      values.set(String(key), String(value));
    },
    removeItem: (key) => {
      values.delete(String(key));
    },
    clear: () => values.clear(),
  };
}

/** Preview-only defense in depth for direct SDK requests and browser navigation. */
function isolateBrowser() {
  for (const name of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(window, name, {
      configurable: true,
      value: memoryStorage(),
    });
  }
  // Analytics stays off; privacy dialogs can still be opened manually.
  localStorage.setItem(
    "cv-builder:privacy-choices",
    JSON.stringify({
      version: "2026-10-06.2",
      analytics: false,
      pending_sync: false,
      expires_at: "2099-01-01T00:00:00Z",
    }),
  );
  const parameters = new URLSearchParams(window.location.search);
  const preserveContext = (value?: string | URL | null) => {
    if (value == null) return value;
    const url = new URL(value, window.location.href);
    if (url.origin !== window.location.origin)
      throw new Error("External navigation is disabled in demo mode.");
    for (const name of [
      "languagePreview",
      "previewSession",
      "demoState",
      "demoPlan",
      "demoMarket",
    ]) {
      const value = parameters.get(name);
      if (value !== null) url.searchParams.set(name, value);
    }
    return url.href;
  };
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (data, unused, url) =>
      original(data, unused, preserveContext(url));
  }
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.href,
    );
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (
      url.origin !== window.location.origin ||
      /\/(api|auth|storage|rest)\//.test(url.pathname) ||
      method !== "GET"
    ) {
      return Promise.reject(
        new Error(
          "Network requests are disabled in Language Studio demo mode.",
        ),
      );
    }
    return originalFetch(input, init);
  };
  // Legacy upload and analytics transports cannot escape the preview either.
  XMLHttpRequest.prototype.send = function () {
    throw new Error("Network requests are disabled in demo mode.");
  };
  navigator.sendBeacon = () => false;
  window.open = () => {
    toast.info(t("Demo mode: external links and downloads are disabled."));
    return null;
  };
  document.addEventListener(
    "click",
    (event) => {
      const link =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      if (!(link instanceof HTMLAnchorElement)) return;
      const url = new URL(link.href, window.location.href);
      if (
        url.origin !== window.location.origin ||
        link.hasAttribute("download") ||
        link.target === "_blank"
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        toast.info(t("Demo mode: external links and downloads are disabled."));
      }
    },
    true,
  );
}

export function installStudioDemo() {
  if (!isStudioPreviewFrame()) return;
  const query = new URLSearchParams(window.location.search);
  const requestedState = query.get("demoState");
  const state: DemoState = ["empty", "loading", "error"].includes(
    requestedState ?? "",
  )
    ? (requestedState as DemoState)
    : "populated";
  const store = createDemoStore(
    state,
    query.get("demoPlan") === "free" ? "free" : "monthly",
    query.get("demoMarket") === "GLOBAL" ? "GLOBAL" : "TR",
  );
  const api = new BackendApi(store.client);
  isolateBrowser();
  function DemoAuthProvider({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const [me, setMe] = useState(store.me);
    const value = useMemo<AuthContextValue>(
      () => ({
        session: null,
        me,
        api,
        initialized: true,
        loadingMe: false,
        isAuthenticated: pathname.startsWith("/app"),
        authMessage: null,
        signIn: async () => {},
        signUp: async () => ({ needsEmailVerification: true }),
        signInWithGoogle: async () => {
          toast.info(t("Demo mode: Google sign-in is disabled."));
        },
        requestPasswordReset: async () => {},
        updatePassword: async () => {},
        signOut: async () => {
          toast.info(t("This is a demo account. No session is signed in."));
        },
        refreshMe: async () => {
          const next = store.me();
          setMe(next);
          return next;
        },
        clearAuthMessage: () => {},
      }),
      [me, pathname],
    );
    return (
      <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
    );
  }
  installStudioRuntime({
    client: store.client,
    AuthProvider: DemoAuthProvider,
  });
}

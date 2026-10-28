import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signInWithOAuth: vi.fn(async (_args: unknown) => ({ error: null })),
  signOut: vi.fn(async (_opts?: unknown) => ({ error: null })),
  fetch: vi.fn<typeof fetch>(),
}));

vi.mock("@/lib/config", () => ({
  config: { apiBaseUrl: "/api/v1", supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon" },
  hasSupabaseConfig: true,
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signInWithOAuth: mocks.signInWithOAuth,
      signOut: mocks.signOut,
    },
  },
  getAccessToken: async () => "token",
}));

const envelope = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const me = (email: string, is_admin: boolean) => envelope(200, { success: true, data: { email, is_admin } });
const apiError = (status: number, code: string) =>
  envelope(status, { success: false, error: { code, message: `${code} message` } });

import { AuthGate, useAuth } from "./AuthGate";

const session = { access_token: "token", user: { id: "user-1", email: "me@example.com" } };

function Protected() {
  return <p>Welcome {useAuth().email}</p>;
}

const renderGate = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthGate>
        <Protected />
      </AuthGate>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  window.history.replaceState(null, "", "/monetization?grain=week");
});

describe("AuthGate", () => {
  it("shows a loading state while the session is restored", () => {
    mocks.getSession.mockReturnValue(new Promise(() => {}));
    renderGate();
    expect(screen.getByText("Checking access…")).toBeTruthy();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("offers Google sign-in when signed out, returning to the current path", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    renderGate();
    fireEvent.click(await screen.findByRole("button", { name: /sign in with google/i }));
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/monetization?grain=week` },
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("shows No access with the email for non-admins and lets them sign out", async () => {
    mocks.getSession.mockResolvedValue({ data: { session } });
    mocks.fetch.mockResolvedValue(me("someone@example.com", false));
    renderGate();
    expect(await screen.findByText("No access")).toBeTruthy();
    expect(screen.getByText("someone@example.com")).toBeTruthy();
    expect(screen.queryByText(/Welcome/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /sign out/i }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" }));
  });

  it("renders the app for admins", async () => {
    mocks.getSession.mockResolvedValue({ data: { session } });
    mocks.fetch.mockResolvedValue(me("admin@example.com", true));
    renderGate();
    expect(await screen.findByText("Welcome admin@example.com")).toBeTruthy();
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(String(url)).toMatch(/\/api\/v1\/admin\/me$/);
    expect(init?.headers).toEqual({ Authorization: "Bearer token" });
  });

  it("shows a retryable error when the access check fails", async () => {
    mocks.getSession.mockResolvedValue({ data: { session } });
    mocks.fetch.mockResolvedValueOnce(apiError(503, "ANALYTICS_UNAVAILABLE"));
    renderGate();
    expect(await screen.findByText("Could not verify access")).toBeTruthy();
    expect(screen.getByText("ANALYTICS_UNAVAILABLE message")).toBeTruthy();
    mocks.fetch.mockResolvedValueOnce(me("admin@example.com", true));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Welcome admin@example.com")).toBeTruthy();
  });

  it("signs out locally when the backend rejects the token and explains why", async () => {
    let onChange: (event: string, next: unknown) => void = () => {};
    mocks.onAuthStateChange.mockImplementationOnce(((cb: typeof onChange) => {
      onChange = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    }) as never);
    mocks.signOut.mockImplementationOnce(async () => {
      onChange("SIGNED_OUT", null);
      return { error: null };
    });
    mocks.getSession.mockResolvedValue({ data: { session } });
    mocks.fetch.mockResolvedValue(apiError(401, "UNAUTHORIZED"));
    renderGate();
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" }));
    expect(await screen.findByText(/session expired or was rejected/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /sign in with google/i })).toBeTruthy();
  });
});

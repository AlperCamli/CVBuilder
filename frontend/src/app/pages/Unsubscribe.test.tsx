import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import Unsubscribe, { UnsubscribeView, type UnsubscribePhase } from "./Unsubscribe";
import { unsubscribeFromMarketing, unsubscribeTokenFromSearch } from "../integration/marketing-email";
import { getHeadMetaForPath } from "../seo/route-seo";
import { analyticsPage } from "../integration/analytics-pages";
import { buildSeoRoutes } from "../../content/seo-meta.mjs";
import { i18n } from "../localization/i18n";
import type { ApiClient } from "../integration/api-client";

const view = (phase: UnsubscribePhase) => renderToStaticMarkup(<MemoryRouter><UnsubscribeView phase={phase} onRetry={() => undefined} /></MemoryRouter>);
const page = (url: string) => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><Unsubscribe /></MemoryRouter>);

afterEach(async () => { await i18n.changeLanguage("en"); });

describe("unsubscribe page", () => {
  it("posts the link token to /marketing/unsubscribe without signing in", async () => {
    const post = vi.fn(async () => ({ ok: true }));
    await unsubscribeFromMarketing("f00dfeed", { post } as unknown as ApiClient);
    expect(post).toHaveBeenCalledExactlyOnceWith("/marketing/unsubscribe", { token: "f00dfeed" });
    await expect(unsubscribeFromMarketing("x", { post: vi.fn(async () => { throw new Error("429"); }) } as unknown as ApiClient)).rejects.toThrow("429");
  });

  it("reads t= from the link", () => {
    expect(unsubscribeTokenFromSearch("?t=ab12cd34")).toBe("ab12cd34");
    expect(unsubscribeTokenFromSearch("?t=")).toBeNull();
    expect(unsubscribeTokenFromSearch("?t=a%20b")).toBeNull();
    expect(unsubscribeTokenFromSearch("")).toBeNull();
  });

  it("starts working at once with a token, and explains a missing one", () => {
    expect(page("/unsubscribe?t=ab12cd34")).toContain("Unsubscribing you…");
    const missing = page("/unsubscribe");
    expect(missing).toContain("This unsubscribe link is incomplete");
    expect(missing).toContain('href="/support"');
  });

  it("confirms, and offers a retry when the request fails", () => {
    const done = view("done");
    expect(done).toContain("You’re unsubscribed");
    expect(done).toContain("You’ll still get emails about your account");
    expect(done).toContain("/images/designs/mascot/point.webp");
    const failed = view("failed");
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Try again");
  });

  it("confirms in Turkish", async () => {
    await i18n.changeLanguage("tr");
    expect(view("done")).toContain("Abonelikten çıktınız");
    expect(view("missing")).toContain("Bu abonelikten çıkma bağlantısı eksik");
    expect(renderToStaticMarkup(<MemoryRouter><UnsubscribeView phase="missing" onRetry={() => undefined} /></MemoryRouter>)).toContain('href="/tr/support"');
  });

  it("stays out of search: noindex, not prerendered, not in the sitemap, token never reported", () => {
    for (const path of ["/unsubscribe", "/tr/unsubscribe"]) {
      expect(getHeadMetaForPath(path)).toEqual({ title: "Unsubscribe | jobspecificCV", robots: "noindex, nofollow" });
      expect(buildSeoRoutes({ categories: [], articles: [] }).some((route: { path: string }) => route.path === path)).toBe(false);
    }
    expect(analyticsPage("/unsubscribe?t=ab12cd34")).toEqual({ path: "/unsubscribe", title: "Email unsubscribe" });
  });
});

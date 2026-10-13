import { afterEach, expect, it, vi } from "vitest";
import { chooseLocale, i18n, pendingLocale, setLanguagePreview } from "../i18n";

afterEach(async () => {
  setLanguagePreview(null);
  vi.unstubAllGlobals();
  await i18n.changeLanguage("en");
});
it("keeps preview locale independent of browser preference and account synchronization", async () => {
  const storage = new Map([
    ["cv-interface-locale", "en"],
    ["cv-locale-needs-sync", "1"],
  ]);
  const writes = vi.fn();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: writes,
  });
  vi.stubGlobal("document", {
    documentElement: { lang: "tr" },
    cookie: "original",
  });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  setLanguagePreview("tr");
  await i18n.changeLanguage("tr");
  chooseLocale("en", false);
  chooseLocale("tr");
  expect(i18n.language).toBe("tr");
  expect(writes).not.toHaveBeenCalled();
  expect(document.cookie).toBe("original");
  expect(pendingLocale()).toBeNull();
});

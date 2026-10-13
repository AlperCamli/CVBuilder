import { afterEach, expect, it } from "vitest";
import { i18n } from "./i18n";
import { reviewText } from "./review-text";

afterEach(async () => {
  await i18n.changeLanguage("en");
});
it("renders generated review text through editable templates and keeps job terms intact", async () => {
  await i18n.changeLanguage("tr");
  expect(reviewText("3/5 terms found. Missing: C++, AWS.")).toBe(
    "3/5 terim bulundu. Eksik: C++, AWS.",
  );
  expect(reviewText("high extraction confidence (82/100).")).toBe(
    "yüksek metin çıkarma güveni (82/100).",
  );
});
it("preserves the original English wording and example facts", async () => {
  await i18n.changeLanguage("en");
  const text =
    "2/4 unique statements contain 6–45 words. Example: Managed 12 engineers at Acme.";
  expect(reviewText(text)).toBe(text);
  await i18n.changeLanguage("tr");
  expect(reviewText(text)).toContain("Örnek: Managed 12 engineers at Acme.");
});

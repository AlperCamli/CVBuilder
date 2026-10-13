import { describe, expect, it } from "vitest";
import { protectTranslationNumbers, validateTranslationTexts, TranslationNumberError } from "../src/modules/ai/cv-translation";

describe("protected translation numbers", () => {
  it("preserves decimals, grouped values and ordinals while translating surrounding text", () => {
    const original = [{ path: "description", text: "Ranked 2nd. Delivered 1,000 reports with 20.5% improvement in 2024." }];
    const protectedText = protectTranslationNumbers(original);
    expect(protectedText.texts[0].text).toBe("Ranked [[CV_NUMBER_A]]nd. Delivered [[CV_NUMBER_B]] reports with [[CV_NUMBER_C]]% improvement in [[CV_NUMBER_D]].");
    const restored = protectedText.restore([{ path: "description", text: "[[CV_NUMBER_D]] yılında [[CV_NUMBER_B]] raporla %[[CV_NUMBER_C]] iyileşme. [[CV_NUMBER_A]]. sırada." }]);
    expect(restored[0].text).toBe("2024 yılında 1,000 raporla %20.5 iyileşme. 2. sırada.");
    expect(() => validateTranslationTexts(original, restored)).not.toThrow();
  });
  it("reports the exact original and attempted text if a number disappears or is invented", () => {
    const original = [{ path: "description", text: "Delivered 20 reports." }];
    const protectedText = protectTranslationNumbers(original);
    const attempted = protectedText.restore([{ path: "description", text: "200 rapor hazırladı." }]);
    try {
      validateTranslationTexts(original, attempted);
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(TranslationNumberError);
      expect((error as TranslationNumberError).issues).toEqual([{ path: "description", original_text: "Delivered 20 reports.", translated_text: "200 rapor hazırladı.", original_numbers: ["20"], translated_numbers: ["200"] }]);
    }
    expect(() => validateTranslationTexts(original, protectedText.restore([{ path: "description", text: "Rapor hazırladı." }]))).toThrow(TranslationNumberError);
  });
  it("keeps markers scoped to their original field and detects duplicated numbers", () => {
    const original = [{ path: "first", text: "Delivered 20 reports." }, { path: "second", text: "Built 3 tools." }];
    const protectedText = protectTranslationNumbers(original);
    const restored = protectedText.restore([{ path: "second", text: "[[CV_NUMBER_A]] araç geliştirdi." }, { path: "first", text: "[[CV_NUMBER_A]] rapor hazırladı." }]);
    expect(restored.map(item => item.text)).toEqual(["3 araç geliştirdi.", "20 rapor hazırladı."]);
    expect(() => validateTranslationTexts(original, restored)).not.toThrow();
    expect(() => validateTranslationTexts(original, protectedText.restore([{ path: "first", text: "[[CV_NUMBER_A]] ve [[CV_NUMBER_A]] rapor." }, { path: "second", text: "[[CV_NUMBER_A]] araç." }]))).toThrow(TranslationNumberError);
  });
  it("leaves original marker-like text unchanged and does not expose invented markers", () => {
    const original = [{ path: "description", text: "Literal [[CV_NUMBER_A]] and 20 reports." }];
    const protectedText = protectTranslationNumbers(original);
    expect(protectedText.texts[0].text).toBe("Literal [[CV_NUMBER_A]] and [[CV_NUMBER_XA]] reports.");
    expect(protectedText.restore(protectedText.texts)).toEqual(original);
    expect(protectedText.restore([{ path: "description", text: "[[CV_NUMBER_XZ]] rapor." }])[0].text).toBe("? rapor.");
  });
});

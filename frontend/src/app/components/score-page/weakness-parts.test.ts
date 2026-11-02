import { describe, expect, it } from "vitest";
import { splitWeakness, weaknessParts } from "./weakness-parts";

// Real weaknesses from the product owner's review (BRIEF.md), joined as the backend stores them.
const NO_QUOTE = "Deneyimlerin çoğu görev anlatıyor; sonuç veya ölçek düzenli biçimde ölçülmemiş. Her rolde mümkünse gerçek kullanıcı, gelir, zaman tasarrufu veya çıktı sayılarını ekleyin; ölçemediğiniz sonuçları sayı uydurmadan açıklayın.";
const SUPPORT = "Bazı maddeler özgül sonuç yerine genel destek görevleri anlatıyor. “Supported online store management and digital marketing initiatives.” Genel görevleri yaptığınız somut eylem ve katkıyla yeniden yazın.";
const SUMMARY = "Özet birden fazla yönü aynı anda sunuyor ve hangi role başvurulduğunu belirtmiyor. “hands-on experience in Business Intelligence, data modeling, and SAP consulting.” Başvuracağınız hedef rolü belirleyip özeti, beceri sırasını ve deneyim vurgularını bu role göre uyumlu hale getirin.";

describe("splitWeakness", () => {
  it("splits issue, quote and fix around the quoted CV line", () => {
    expect(splitWeakness(SUPPORT)).toEqual({
      text: SUPPORT,
      issue: "Bazı maddeler özgül sonuç yerine genel destek görevleri anlatıyor.",
      quote: "Supported online store management and digital marketing initiatives.",
      fix: "Genel görevleri yaptığınız somut eylem ve katkıyla yeniden yazın."
    });
    expect(splitWeakness(SUMMARY)).toMatchObject({
      issue: "Özet birden fazla yönü aynı anda sunuyor ve hangi role başvurulduğunu belirtmiyor.",
      quote: "hands-on experience in Business Intelligence, data modeling, and SAP consulting.",
      fix: "Başvuracağınız hedef rolü belirleyip özeti, beceri sırasını ve deneyim vurgularını bu role göre uyumlu hale getirin."
    });
  });

  it("keeps a string without a quote whole, with no fix box", () => {
    expect(splitWeakness(NO_QUOTE)).toEqual({ text: NO_QUOTE, issue: NO_QUOTE, quote: null, fix: null });
    // Deterministic suggestions use straight quotes, which are not CV quotes.
    const basic = "Replace phrases such as 'responsible for' or 'team player' with specific examples.";
    expect(splitWeakness(basic)).toEqual({ text: basic, issue: basic, quote: null, fix: null });
  });

  it("handles a quote at the start or end, and an unclosed quote", () => {
    expect(splitWeakness("“Built reporting tools” Add the outcome.")).toMatchObject({ issue: "Add the outcome.", quote: "Built reporting tools", fix: null });
    expect(splitWeakness("Too generic. “Built reporting tools”")).toMatchObject({ issue: "Too generic.", quote: "Built reporting tools", fix: null });
    expect(splitWeakness("Too generic. “Built reporting tools")).toMatchObject({ issue: "Too generic. “Built reporting tools", quote: null, fix: null });
    expect(splitWeakness("“Only a quote”")).toMatchObject({ issue: "“Only a quote”", quote: null, fix: null });
  });
});

describe("weaknessParts", () => {
  it("uses structured details when they line up with improvements", () => {
    const parts = weaknessParts({
      improvements: [NO_QUOTE, SUPPORT],
      improvement_details: [
        { text: NO_QUOTE, issue: "Deneyimlerin çoğu görev anlatıyor; sonuç veya ölçek düzenli biçimde ölçülmemiş.", quote: null, fix: "Her rolde mümkünse gerçek kullanıcı, gelir, zaman tasarrufu veya çıktı sayılarını ekleyin; ölçemediğiniz sonuçları sayı uydurmadan açıklayın." },
        { text: SUPPORT, issue: "Bazı maddeler özgül sonuç yerine genel destek görevleri anlatıyor.", quote: "Supported online store management and digital marketing initiatives.", fix: "Genel görevleri yaptığınız somut eylem ve katkıyla yeniden yazın." }
      ]
    });
    expect(parts[0]).toMatchObject({ quote: null, fix: expect.stringMatching(/^Her rolde/) });
    expect(parts[1].quote).toBe("Supported online store management and digital marketing initiatives.");
  });

  it("falls back to splitting the strings when details are missing or misaligned", () => {
    expect(weaknessParts({ improvements: [SUPPORT] })[0].fix).toBe("Genel görevleri yaptığınız somut eylem ve katkıyla yeniden yazın.");
    const misaligned = weaknessParts({ improvements: [NO_QUOTE, SUPPORT], improvement_details: [{ text: SUPPORT, issue: "x", quote: null, fix: null }] });
    expect(misaligned.map(part => part.issue)).toEqual([NO_QUOTE, "Bazı maddeler özgül sonuç yerine genel destek görevleri anlatıyor."]);
  });
});

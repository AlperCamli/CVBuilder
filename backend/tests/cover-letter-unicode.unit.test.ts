import { describe, expect, it } from "vitest";
import { generateCoverLetterPdf } from "../src/modules/cover-letters/cover-letters.service";
import { extractPdfText } from "./helpers/pdf-text";

describe("Turkish cover-letter PDF", () => {
  it("exports readable Turkish characters without ASCII transliteration", async () => {
    const bytes = await generateCoverLetterPdf("Başvuru — Çağrı Işık", "Sayın İşe Alım Yetkilisi,\n\nİstanbul şehrinde çalışıyorum. Güçlü iletişim becerilerimle ekibinize katkı sağlamak istiyorum.\n\nSaygılarımla,\nÇağrı Işık");
    const stdout = await extractPdfText(bytes);
    expect(stdout).toContain("Çağrı Işık");
    expect(stdout).toContain("İstanbul");
    expect(stdout).toContain("Güçlü");
    expect(stdout).toContain("çalışıyorum");
  });
});

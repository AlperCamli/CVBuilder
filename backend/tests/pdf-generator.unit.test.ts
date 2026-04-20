import { describe, expect, it } from "vitest";
import { generatePdfDocument } from "../src/modules/exports/generators/pdf-generator";
import type { ExportDocumentModel } from "../src/modules/exports/generators/rendering-document.mapper";

describe("pdf generator", () => {
  it("generates a PDF for unicode-heavy content without throwing", async () => {
    const model: ExportDocumentModel = {
      title: "EDANUR GÖKTEN",
      subtitle: "Yazılım Mühendisi",
      contact_line: "istanbul@example.com • +90 555 123 45 67",
      theme: {
        heading_color_rgb: [28, 28, 33],
        accent_color_rgb: [26, 99, 176]
      },
      sections: [
        {
          title: "Deneyim",
          blocks: [
            {
              headline: "Kıdemli Geliştirici",
              subheadline: "Şirket A",
              metadata_line: "2024 - Present • İstanbul, Türkiye",
              bullets: ["Ölçeklenebilir API geliştirdim", "Veri işleme maliyetini düşürdüm"],
              body: null
            }
          ]
        }
      ]
    };

    const bytes = await generatePdfDocument(model);

    expect(bytes.byteLength).toBeGreaterThan(100);
  });
});

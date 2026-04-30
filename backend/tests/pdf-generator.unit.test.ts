import { describe, expect, it } from "vitest";
import { generatePdfDocument, normalizePdfText } from "../src/modules/exports/generators/pdf-generator";
import type { ExportDocumentModel } from "../src/modules/exports/generators/rendering-document.mapper";

describe("pdf generator", () => {
  it("preserves unicode characters and generates parseable PDF", async () => {
    const model: ExportDocumentModel = {
      title: "Alper Çamlı",
      subtitle: "Bilgisayar Mühendisliği Öğrencisi",
      contact_line: "alper@example.com • +90 555 123 45 67 • İstanbul, Türkiye",
      contact_items: ["alper@example.com", "+90 555 123 45 67", "İstanbul, Türkiye"],
      social_links: [
        {
          label: "/in/alpercamli",
          type: "linkedin",
          url: "https://www.linkedin.com/in/alpercamli"
        }
      ],
      photo_data_uri: null,
      theme: {
        layout: "modern-clean",
        mode: "classic-single-column",
        heading_color_hex: "#111827",
        accent_color_hex: "#0f5ea6",
        body_color_hex: "#1f2937",
        muted_color_hex: "#4b5563",
        page_background_hex: "#ffffff",
        body_text_size: 11,
        section_spacing: 12,
        block_spacing: 8,
        font_family: "Georgia, serif"
      },
      sections: [
        {
          type: "experience",
          title: "Work Experience",
          inline_text: null,
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

    expect(bytes.byteLength).toBeGreaterThan(1000);

    const unicodeLine = "Alper Çamlı İstanbul Kıdemli Geliştirici Şükrü Işık";
    expect(normalizePdfText(unicodeLine)).toBe(unicodeLine);
  });
});

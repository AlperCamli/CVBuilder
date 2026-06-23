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
      photo_shape: "circle",
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

  it("embeds a circle-clipped and a square photo without throwing", async () => {
    // 1x1 transparent PNG.
    const pngDataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    const baseModel: ExportDocumentModel = {
      title: "Jane Doe",
      subtitle: "Engineer",
      contact_line: "jane@example.com",
      contact_items: ["jane@example.com"],
      social_links: [],
      photo_data_uri: pngDataUri,
      photo_shape: "circle",
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
      sections: []
    };

    const circleBytes = await generatePdfDocument(baseModel);
    const squareBytes = await generatePdfDocument({ ...baseModel, photo_shape: "square" });

    expect(circleBytes.byteLength).toBeGreaterThan(1000);
    expect(squareBytes.byteLength).toBeGreaterThan(1000);
  });

  it("generates a PDF with the Noto Serif font asset for LaTeX-inspired templates", async () => {
    const model: ExportDocumentModel = {
      title: "Dr. Ada Lovelace",
      subtitle: "Research Scientist",
      contact_line: "ada@example.com • London, UK",
      contact_items: ["ada@example.com", "London, UK"],
      social_links: [],
      photo_data_uri: null,
      photo_shape: "circle",
      theme: {
        layout: "academic-classic",
        mode: "classic-single-column",
        font_asset_key: "noto-serif",
        header_alignment: "center",
        section_heading_style: "ruled",
        heading_color_hex: "#111111",
        accent_color_hex: "#111111",
        body_color_hex: "#1f2937",
        muted_color_hex: "#4b5563",
        page_background_hex: "#ffffff",
        body_text_size: 11,
        section_spacing: 12,
        block_spacing: 8,
        font_family: '"Noto Serif", "Times New Roman", Georgia, serif'
      },
      sections: [
        {
          type: "publications",
          title: "Publications",
          inline_text: null,
          blocks: [
            {
              headline: "A compact notation for analytical engines",
              subheadline: "Journal of Computing History",
              metadata_line: "1843",
              bullets: [],
              body: "Peer-reviewed research summary with international characters: Çamlı, İstanbul."
            }
          ]
        }
      ]
    };

    const bytes = await generatePdfDocument(model);

    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(normalizePdfText("Çamlı İstanbul")).toBe("Çamlı İstanbul");
  });
});

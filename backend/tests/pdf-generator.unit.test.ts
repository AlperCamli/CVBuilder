import { describe, expect, it } from "vitest";
import { PDFDocument, PDFDict, PDFName, PDFString } from "pdf-lib";
import { generatePdfDocument, normalizePdfText } from "../src/modules/exports/generators/pdf-generator";
import type { ExportDocumentModel } from "../src/modules/exports/generators/rendering-document.mapper";

const collectLinkUris = (pdf: PDFDocument): string[] => {
  const uris: string[] = [];
  for (const page of pdf.getPages()) {
    const annots = page.node.Annots();
    if (!annots) {
      continue;
    }
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookupMaybe(i, PDFDict);
      const action = annot?.lookupMaybe(PDFName.of("A"), PDFDict);
      const uri = action?.lookupMaybe(PDFName.of("URI"), PDFString);
      if (uri) {
        uris.push(uri.asString());
      }
    }
  }
  return uris;
};

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
      photo_position: "left",
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
      photo_position: "left",
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
    const squareBytes = await generatePdfDocument({
      ...baseModel,
      photo_shape: "square",
      photo_position: "right"
    });

    expect(circleBytes.byteLength).toBeGreaterThan(1000);
    expect(squareBytes.byteLength).toBeGreaterThan(1000);
  });

  it("generates a PDF with the selected catalog font asset for LaTeX-inspired templates", async () => {
    const widePngDataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAARSURBVAiZY/jPwPCfgeH/fwAP+QP9dhJt3wAAAABJRU5ErkJggg==";
    const model: ExportDocumentModel = {
      title: "Dr. Ada Lovelace",
      subtitle: "Research Scientist",
      contact_line: "ada@example.com • London, UK",
      contact_items: ["ada@example.com", "London, UK"],
      social_links: [],
      photo_data_uri: widePngDataUri,
      photo_shape: "circle",
      photo_position: "center",
      theme: {
        layout: "academic-classic",
        mode: "classic-single-column",
        font_asset_key: "latin-modern-roman",
        header_alignment: "center",
        header_photo_size: 76,
        section_heading_style: "ruled",
        heading_color_hex: "#111111",
        accent_color_hex: "#111111",
        body_color_hex: "#1f2937",
        muted_color_hex: "#4b5563",
        page_background_hex: "#ffffff",
        body_text_size: 11,
        section_spacing: 12,
        block_spacing: 8,
        font_family: '"Latin Modern Roman", serif'
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

  it("adds clickable link annotations for social links, emails, and phone numbers", async () => {
    const model: ExportDocumentModel = {
      title: "Yunus Emre Gökbudak",
      subtitle: "Software Engineer",
      contact_line: "yunus@example.com • +90 555 123 45 67 • İstanbul",
      contact_items: ["yunus@example.com", "+90 555 123 45 67", "İstanbul"],
      social_links: [
        {
          label: "/in/yunusemregökbudak",
          type: "linkedin",
          url: "https://www.linkedin.com/in/yunusemregökbudak"
        }
      ],
      photo_data_uri: null,
      photo_shape: "circle",
      photo_position: "left",
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

    const bytes = await generatePdfDocument(model);
    const pdf = await PDFDocument.load(bytes);
    const uris = collectLinkUris(pdf);

    // Non-ASCII URLs stay clickable: the link target is percent-encoded for the annotation...
    expect(uris.some((uri) => uri.includes("/in/yunusemreg%C3%B6kbudak"))).toBe(true);
    expect(uris.some((uri) => uri === "mailto:yunus@example.com")).toBe(true);
    expect(uris.some((uri) => uri === "tel:+905551234567")).toBe(true);
    // ...while a plain location is not turned into a link.
    expect(uris.some((uri) => uri.includes("stanbul"))).toBe(false);
  });
});

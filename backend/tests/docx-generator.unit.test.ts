import { describe, expect, it } from "vitest";
import { generateDocxDocument } from "../src/modules/exports/generators/docx-generator";
import type { ExportDocumentModel } from "../src/modules/exports/generators/rendering-document.mapper";

describe("docx generator", () => {
  it("generates a DOCX with LaTeX-inspired serif style tokens", async () => {
    const widePngDataUri =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAARSURBVAiZY/jPwPCfgeH/fwAP+QP9dhJt3wAAAABJRU5ErkJggg==";
    const model: ExportDocumentModel = {
      title: "Ada Lovelace",
      subtitle: "Research Scientist",
      contact_line: "ada@example.com • London, UK",
      contact_items: ["ada@example.com", "London, UK"],
      social_links: [],
      photo_data_uri: widePngDataUri,
      photo_shape: "circle",
      photo_position: "right",
      theme: {
        layout: "academic-classic",
        mode: "classic-single-column",
        font_asset_key: "noto-serif",
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
        font_family: '"Noto Serif", "Times New Roman", Georgia, serif'
      },
      sections: [
        {
          type: "publications",
          title: "Publications",
          inline_text: null,
          blocks: [
            {
              headline: "Analytical Engine Notes",
              subheadline: "Scientific Memoirs",
              metadata_line: "1843",
              bullets: ["Translated and expanded Menabrea's work"],
              body: "Academic publication summary."
            }
          ]
        }
      ]
    };

    const bytes = await generateDocxDocument(model);

    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

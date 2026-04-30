import { describe, expect, it } from "vitest";
import type { RenderingPresentation } from "../src/modules/rendering/rendering-presentation";
import { mapPresentationToExportDocument } from "../src/modules/exports/generators/rendering-document.mapper";

const basePresentation = (): RenderingPresentation => ({
  version: "v1",
  document_title: "Tailored CV",
  theme: {
    layout: "modern-clean",
    mode: "classic-single-column",
    template_slug: "modern-clean",
    template_name: "Modern Clean",
    tokens: {
      font_family: "Georgia, serif",
      heading_color_hex: "#111827",
      accent_color_hex: "#0f5ea6",
      body_color_hex: "#1f2937",
      muted_color_hex: "#4b5563",
      page_background_hex: "#ffffff",
      section_spacing: 16,
      block_spacing: 12,
      body_text_size: 12,
      compact_density: true
    }
  },
  header: {
    name: "Alper Çamlı",
    title: "Computer Science Student",
    email: "alper@example.com",
    phone: "+90 500 000 00 00",
    location: "Istanbul, Turkey",
    photo: null,
    contact_items: ["alper@example.com", "+90 500 000 00 00", "Istanbul, Turkey"],
    social_links: [
      {
        id: "social-1",
        type: "linkedin",
        url: "https://www.linkedin.com/in/alpercamli",
        label: "/in/alpercamli"
      }
    ]
  },
  sections: [
    {
      id: "summary",
      type: "summary",
      title: "Professional Summary",
      inline_text: null,
      items: [
        {
          id: "summary-item",
          title: null,
          subtitle: null,
          date_range: null,
          location: null,
          metadata_line: null,
          body: "Highly motivated student.",
          bullets: []
        }
      ]
    }
  ]
});

describe("presentation to export document mapper", () => {
  it("maps header + social links + sections", () => {
    const presentation = basePresentation();

    const mapped = mapPresentationToExportDocument(presentation);

    expect(mapped.title).toBe("Alper Çamlı");
    expect(mapped.subtitle).toBe("Computer Science Student");
    expect(mapped.contact_line).toBe("alper@example.com • +90 500 000 00 00 • Istanbul, Turkey");
    expect(mapped.social_links).toHaveLength(1);
    expect(mapped.social_links[0]?.label).toBe("/in/alpercamli");
    expect(mapped.sections).toHaveLength(1);
    expect(mapped.sections[0]?.title).toBe("Professional Summary");
    expect(mapped.sections[0]?.blocks[0]?.body).toBe("Highly motivated student.");
  });

  it("keeps inline sections without inventing blocks", () => {
    const presentation = basePresentation();
    presentation.sections = [
      {
        id: "skills",
        type: "skills",
        title: "Skills",
        inline_text: "PostgreSQL, Spark, Python",
        items: []
      }
    ];

    const mapped = mapPresentationToExportDocument(presentation);

    expect(mapped.sections).toHaveLength(1);
    expect(mapped.sections[0]?.inline_text).toBe("PostgreSQL, Spark, Python");
    expect(mapped.sections[0]?.blocks).toHaveLength(0);
  });

  it("accepts data-uri photo only", () => {
    const presentation = basePresentation();
    presentation.header.photo = "https://example.com/photo.jpg";

    const mappedWithoutDataUri = mapPresentationToExportDocument(presentation);
    expect(mappedWithoutDataUri.photo_data_uri).toBeNull();

    presentation.header.photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO6W8h4AAAAASUVORK5CYII=";
    const mappedDataUri = mapPresentationToExportDocument(presentation);
    expect(mappedDataUri.photo_data_uri?.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("uses document title fallback before generic CV fallback", () => {
    const presentation = basePresentation();
    presentation.header.name = null;
    presentation.document_title = "My Tailored Resume";

    const mappedFromDocumentTitle = mapPresentationToExportDocument(presentation);
    expect(mappedFromDocumentTitle.title).toBe("My Tailored Resume");

    presentation.document_title = null;
    const mappedGeneric = mapPresentationToExportDocument(presentation);
    expect(mappedGeneric.title).toBe("CV");
  });
});

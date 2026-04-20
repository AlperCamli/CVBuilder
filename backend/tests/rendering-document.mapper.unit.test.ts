import { describe, expect, it } from "vitest";
import type { RenderingPayload } from "../src/modules/rendering/rendering.types";
import { mapRenderingPayloadToExportDocument } from "../src/modules/exports/generators/rendering-document.mapper";

const baseRenderingPayload = (): RenderingPayload =>
  ({
    version: "v1",
    document: {
      kind: "master",
      id: "master-1",
      title: "Imported CV",
      language: "en",
      generated_at: "2026-04-20T00:00:00.000Z",
      updated_at: null,
      context: {
        full_name: "Alper Camli",
        email: "alper@example.com"
      }
    },
    template: {
      resolution: "none",
      template: null
    },
    sections: [],
    plain_text: ""
  }) as RenderingPayload;

describe("rendering document mapper", () => {
  it("suppresses duplicate body text when it matches non-summary headings", () => {
    const rendering = baseRenderingPayload();
    rendering.sections = [
      {
        id: "experience",
        type: "experience",
        title: "Experience",
        order: 0,
        meta: {},
        plain_text: "Backend Engineer",
        blocks: [
          {
            id: "experience-1",
            type: "experience",
            order: 0,
            visibility: "visible",
            fields: {},
            meta: {},
            plain_text: "Backend Engineer",
            normalized_fields: {
              description: {
                raw: "Backend Engineer",
                text: "Backend Engineer",
                text_items: []
              }
            },
            derived: {
              headline: "Backend Engineer",
              subheadline: null,
              bullets: [],
              date_range: null,
              location: null
            }
          }
        ]
      }
    ];

    const mapped = mapRenderingPayloadToExportDocument(rendering, null);

    expect(mapped.sections).toHaveLength(1);
    expect(mapped.sections[0]?.blocks).toHaveLength(1);
    expect(mapped.sections[0]?.blocks[0]?.headline).toBe("Backend Engineer");
    expect(mapped.sections[0]?.blocks[0]?.body).toBeNull();
  });

  it("keeps summary body when summary headline mirrors the same text", () => {
    const rendering = baseRenderingPayload();
    rendering.sections = [
      {
        id: "summary",
        type: "summary",
        title: "Summary",
        order: 0,
        meta: {},
        plain_text: "Backend engineer focused on APIs.",
        blocks: [
          {
            id: "summary-1",
            type: "summary",
            order: 0,
            visibility: "visible",
            fields: {},
            meta: {},
            plain_text: "Backend engineer focused on APIs.",
            normalized_fields: {
              summary: {
                raw: "Backend engineer focused on APIs.",
                text: "Backend engineer focused on APIs.",
                text_items: []
              }
            },
            derived: {
              headline: "Backend engineer focused on APIs.",
              subheadline: null,
              bullets: [],
              date_range: null,
              location: null
            }
          }
        ]
      }
    ];

    const mapped = mapRenderingPayloadToExportDocument(rendering, null);

    expect(mapped.sections).toHaveLength(1);
    expect(mapped.sections[0]?.blocks).toHaveLength(1);
    expect(mapped.sections[0]?.blocks[0]?.headline).toBeNull();
    expect(mapped.sections[0]?.blocks[0]?.body).toBe("Backend engineer focused on APIs.");
  });
});


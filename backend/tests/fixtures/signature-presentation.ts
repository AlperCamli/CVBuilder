import { mapRenderingPayloadToPresentation, type PresentationItem, type RenderingPresentation } from "../../src/modules/rendering/rendering-presentation";
import type { RenderingPayload } from "../../src/modules/rendering/rendering.types";
import type { TemplateSummary } from "../../src/modules/templates/templates.types";

import { SIGNATURE_TEMPLATES } from "../../src/modules/rendering/signature-template-profiles";

export const signatureTemplates = SIGNATURE_TEMPLATES;

export function signaturePresentation(slug: string): RenderingPresentation {
  const template: TemplateSummary = {
    id: slug, slug, name: signatureTemplates.find(t => t.slug === slug)?.name ?? slug,
    status: "active", module_type: "standard", preview_config: null, export_config: null,
    created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-05T00:00:00Z"
  };
  const payload: RenderingPayload = {
    version: "v1", document: { kind: "master", id: "sample", title: "Alex Morgan", language: "en",
      generated_at: "2026-10-05T00:00:00Z", updated_at: null, context: {} },
    template: { resolution: "selected", template }, sections: [], plain_text: ""
  };
  const presentation = mapRenderingPayloadToPresentation(payload, {
    full_name: "Alex Morgan", headline: "Senior Product Designer", email: "alex@example.com",
    phone: "+44 7700 900123", location: "London, UK"
  }, template);
  presentation.header.social_links = [{ id: "portfolio", label: "alexmorgan.design", type: "website", url: "https://example.com/portfolio" }];
  const item = (id: string, title: string, subtitle: string, dates: string, bullets: string[]): PresentationItem => ({
    id, title, subtitle, date_range: dates, metadata_line: dates, location: null, body: null, bullets
  });
  presentation.sections = [
    { id: "summary", type: "summary", title: "Professional Summary", inline_text: "Product designer with eight years of experience turning complex problems into thoughtful digital experiences.", items: [] },
    { id: "experience", type: "experience", title: "Work Experience", inline_text: null, items: [
      item("role-1", "Senior Product Designer", "Forma Studio", "2022 – Present", [
        "Redesigned a platform for 40,000 customers, improving activation by 28%.",
        "Built a shared design system across three products."
      ]),
      item("role-2", "Product Designer", "Northstar Digital", "2018 – 2022", [
        "Designed accessible web and mobile experiences.",
        "Reduced support requests by 19% through usability testing."
      ])
    ] },
    { id: "projects", type: "projects", title: "Projects", inline_text: null, items: [
      item("project-1", "A clearer way to bank", "Independent design project", "2024", ["Simplified everyday banking with inclusive design."])
    ] },
    { id: "education", type: "education", title: "Education", inline_text: null, items: [
      item("education-1", "BA, Communication Design", "University of the Arts London", "2014 – 2018", [])
    ] },
    { id: "skills", type: "skills", title: "Skills", inline_text: null, items: [{ id: "skills-1", title: null, subtitle: null, date_range: null, metadata_line: null, location: null, body: null, bullets: ["Product strategy", "Interaction design", "User research", "Design systems", "Figma & prototyping"] }] },
    { id: "languages", type: "languages", title: "Languages", inline_text: "English · Native\nFrench · Professional", items: [] }
  ];
  // These two profiles request the existing inline skills presentation.
  if (presentation.theme.mode === "ledger-split" || presentation.theme.mode === "contour-cards") {
    const skills = presentation.sections.find(section => section.type === "skills")!;
    skills.inline_text = skills.items[0].bullets.join(", ");
    skills.items = [];
  }
  return presentation;
}

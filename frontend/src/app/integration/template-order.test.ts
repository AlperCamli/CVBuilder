import { describe, expect, it } from "vitest";
import { BALANCED_TEMPLATE_ORDER, sortTemplatesForGallery } from "./template-order";
import catalog from "../pages/designs/template-order-catalog.json";
import { standardModule } from "../modules/standard.module";

describe("balanced template gallery order", () => {
  it("offers every standard template once, starting with six different layout families", () => {
    expect(new Set(BALANCED_TEMPLATE_ORDER).size).toBe(BALANCED_TEMPLATE_ORDER.length);
    expect([...BALANCED_TEMPLATE_ORDER].sort()).toEqual([...standardModule.templateSlugs].sort());
    const input = [...catalog].reverse();
    expect(sortTemplatesForGallery(input).map(template => template.slug)).toEqual(BALANCED_TEMPLATE_ORDER);
    expect(sortTemplatesForGallery(input).slice(0, 6).map(template => template.name)).toEqual([
      "Academic Serif", "Horizon", "Studio", "Editorial", "Ledger", "Mosaic"
    ]);
    expect(input[0]).toEqual(catalog.at(-1));
  });

  it("keeps future templates available and sorts the independent medical gallery by name", () => {
    const medical = [{slug:"medical-professional", name:"Medical Professional"}, {slug:"medical-classic", name:"Medical Classic"}];
    expect(sortTemplatesForGallery(medical).map(template => template.slug)).toEqual(["medical-classic", "medical-professional"]);
    const ordered = sortTemplatesForGallery([...medical, ...catalog]);
    expect(ordered.slice(0, catalog.length).map(template => template.slug)).toEqual(BALANCED_TEMPLATE_ORDER);
    expect(ordered).toHaveLength(catalog.length + medical.length);
  });
});

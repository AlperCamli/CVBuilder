import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFDict, PDFName, PDFString } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { generatePdfDocument } from "../src/modules/exports/generators/pdf-generator";
import { mapPresentationToExportDocument } from "../src/modules/exports/generators/rendering-document.mapper";
import { generateDocxDocument } from "../src/modules/exports/generators/docx-generator";
import { signaturePresentation, signatureTemplates } from "./fixtures/signature-presentation";

async function inspectPdf(bytes: Uint8Array) {
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: false }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= doc.numPages; index++) {
    const page = await doc.getPage(index);
    const content = await page.getTextContent();
    const text: string[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      text.push(item.str);
      expect(item.transform[4]).toBeGreaterThanOrEqual(0);
      expect(item.transform[4] + item.width).toBeLessThanOrEqual(596);
      expect(item.transform[5]).toBeGreaterThan(20);
      expect(item.transform[5]).toBeLessThan(842);
    }
    pages.push(text.join(" "));
  }
  await doc.destroy();
  return pages;
}

describe.each(signatureTemplates)("$name signature template", ({ slug, layout }) => {
  it("resolves a distinct layout through the existing mapper and registers an active exportable row", () => {
    const presentation = signaturePresentation(slug);
    const model = mapPresentationToExportDocument(presentation);
    expect(presentation.theme.mode).toBe(layout);
    expect(model.theme.mode).toBe(layout);
    expect(model.theme.font_asset_key).toBe(presentation.theme.tokens.font_asset_key);
    expect(model.sections).toHaveLength(presentation.sections.length);
    const migration = readFileSync("supabase/migrations/20261005130000_signature_layouts_and_palettes.sql", "utf8");
    const seed = readFileSync("supabase/seed.sql", "utf8");
    for (const sql of [migration, seed]) expect(sql).toContain(`'${slug}', 'active', 'standard'`);
    expect(migration).toContain('"pdf":{"enabled":true}');
  });

  it("exports a readable one-page A4 sample with embedded fonts and clickable contact links", async () => {
    const bytes = await generatePdfDocument(mapPresentationToExportDocument(signaturePresentation(slug)));
    const pages = await inspectPdf(bytes);
    expect(pages).toHaveLength(1);
    for (const text of ["Alex", "Morgan", "Experience", "Education", "Skills", "Languages", "40,000", "19%"])
      expect(pages.join(" ").toLowerCase()).toContain(text.toLowerCase());
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 595, height: 842 });
    const annots = pdf.getPage(0).node.Annots()!;
    const links: string[] = [];
    for (let i = 0; i < annots.size(); i++) {
      const uri = annots.lookup(i, PDFDict).lookupMaybe(PDFName.of("A"), PDFDict)?.lookupMaybe(PDFName.of("URI"), PDFString);
      if (uri) links.push(uri.asString());
    }
    expect(links).toContain("mailto:alex@example.com");
    expect(links).toContain("https://example.com/portfolio");
    expect(pdf.getPage(0).node.Resources()?.lookup(PDFName.of("Font"), PDFDict).keys().length).toBeGreaterThan(0);
  });

  it("paginates long CVs without losing entries or drawing text outside the page", async () => {
    const presentation = signaturePresentation(slug);
    const experience = presentation.sections.find(section => section.type === "experience")!;
    experience.items = Array.from({ length: 16 }, (_, i) => ({ ...experience.items[0], id: `job-${i}`, title: `UniqueRole${i}End` }));
    const pages = await inspectPdf(await generatePdfDocument(mapPresentationToExportDocument(presentation), {
      font_scale: 1.15, spacing_scale: 1.4, layout_scale: 1.3
    }));
    expect(pages.length).toBeGreaterThan(1);
    const text = pages.join(" ");
    for (let i = 0; i < 16; i++) expect(text).toContain(`UniqueRole${i}End`);
    expect(text.toLowerCase()).toContain("education");
    expect(text.toLowerCase()).toContain("languages");
  });

  it.each(["left", "center", "right"] as const)("supports a %s photo and Unicode names", async position => {
    const presentation = signaturePresentation(slug);
    presentation.header.name = "Alper Çamlı";
    presentation.header.photo_position = position;
    presentation.header.photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const text = (await inspectPdf(await generatePdfDocument(mapPresentationToExportDocument(presentation)))).join(" ").replaceAll(" ", "");
    expect(text).toContain("AlperÇamlı");
  });

  it("keeps the existing DOCX exporter available", async () => {
    const bytes = await generateDocxDocument(mapPresentationToExportDocument(signaturePresentation(slug)));
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});

const luminance = (hex: string): number => {
  const channels = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrast = (a: string, b: string): number => {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

describe("Signature palette collection", () => {
  it("offers six compositions with exactly two additional palettes per layout", () => {
    expect(signatureTemplates).toHaveLength(18);
    const modes = new Set(signatureTemplates.map(template => template.layout));
    expect(modes.size).toBe(6);
    for (const mode of modes) expect(signatureTemplates.filter(template => template.layout === mode)).toHaveLength(3);
  });

  it.each(signatureTemplates)("$name preserves content and exports every palette role with readable contrast", ({ slug, layout }) => {
    const presentation = signaturePresentation(slug);
    expect(presentation.sections).toEqual(signaturePresentation(layout).sections);
    expect(presentation.sections.find(section => section.type === "skills")?.title).toBe("Skills");
    const theme = mapPresentationToExportDocument(presentation).theme;
    const tokens = presentation.theme.tokens;
    for (const key of ["header_background_hex", "header_text_color_hex", "header_accent_color_hex", "header_muted_color_hex", "surface_color_hex"] as const)
      expect(theme[key]).toBe(tokens[key]);
    for (const foreground of [theme.header_text_color_hex!, theme.header_accent_color_hex!, theme.header_muted_color_hex!])
      expect(contrast(foreground, theme.header_background_hex!)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(theme.accent_color_hex, theme.surface_color_hex!)).toBeGreaterThanOrEqual(4.5);
  });
});

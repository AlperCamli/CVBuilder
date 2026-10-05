import { buildCvFontFamily, type CvFontAssetKey } from "../../shared/cv-fonts/cv-font-catalog";
import type { TemplateProfile, PresentationLayoutMode } from "./rendering-presentation";

type SignatureLayout = Extract<PresentationLayoutMode,
  "studio-banner" | "editorial-index" | "horizon-rail" | "mosaic-columns" | "ledger-split" | "contour-cards">;
interface Palette {
  ink: string;
  accent: string;
  highlight: string;
  surface: string;
}
const palettes = {
  teal: { ink: "#123d3a", accent: "#087378", highlight: "#ed947f", surface: "#f7eeea" },
  plum: { ink: "#302441", accent: "#74519a", highlight: "#d8b5f2", surface: "#f2edf8" },
  navy: { ink: "#172b46", accent: "#a45b16", highlight: "#efb65f", surface: "#edf2f7" },
  ocean: { ink: "#123852", accent: "#176784", highlight: "#a0ddf0", surface: "#eaf4f8" },
  terracotta: { ink: "#572c27", accent: "#a34432", highlight: "#ffc2a8", surface: "#fbefe8" },
  forest: { ink: "#203e32", accent: "#38704e", highlight: "#b9deb2", surface: "#edf4ec" },
  graphite: { ink: "#292e38", accent: "#526071", highlight: "#d6dce6", surface: "#f0f2f5" },
  rose: { ink: "#50243e", accent: "#9b426d", highlight: "#f6b6d0", surface: "#faeef4" },
  cobalt: { ink: "#23355d", accent: "#335cb4", highlight: "#b6cbff", surface: "#edf1fc" }
} satisfies Record<string, Palette>;

const families: Array<{
  layout: SignatureLayout; name: string; font: CvFontAssetKey;
  palettes: [keyof typeof palettes, keyof typeof palettes, keyof typeof palettes];
}> = [
  { layout: "studio-banner", name: "Studio", font: "source-sans-3", palettes: ["teal", "ocean", "terracotta"] },
  { layout: "editorial-index", name: "Editorial", font: "source-serif-4", palettes: ["plum", "forest", "graphite"] },
  { layout: "horizon-rail", name: "Horizon", font: "ibm-plex-sans", palettes: ["navy", "forest", "plum"] },
  { layout: "mosaic-columns", name: "Mosaic", font: "source-sans-3", palettes: ["ocean", "rose", "graphite"] },
  { layout: "ledger-split", name: "Ledger", font: "ibm-plex-sans", palettes: ["terracotta", "teal", "plum"] },
  { layout: "contour-cards", name: "Contour", font: "noto-sans", palettes: ["rose", "cobalt", "forest"] }
];

/** A variant changes palette roles, never the CV content or family composition. */
export const SIGNATURE_TEMPLATES = families.flatMap(family => family.palettes.map((paletteName, index) => ({
  slug: index === 0 ? family.layout : `${family.layout}-${paletteName}`,
  name: index === 0 ? family.name : `${family.name} ${paletteName[0].toUpperCase()}${paletteName.slice(1)}`,
  layout: family.layout,
  font: family.font,
  paletteName,
  palette: palettes[paletteName],
  isBase: index === 0
})));

export const SIGNATURE_TEMPLATE_PROFILES: Record<string, TemplateProfile> = Object.fromEntries(
  SIGNATURE_TEMPLATES.map(({ slug, layout, font, palette }) => {
    const dark = layout === "studio-banner" || layout === "horizon-rail";
    const filled = layout === "mosaic-columns" || layout === "contour-cards";
    return [slug, {
      layout, mode: layout, skills_display: layout === "ledger-split" || layout === "contour-cards" ? "inline" : "bulleted",
      tokens: {
        font_family: buildCvFontFamily(font), font_asset_key: font,
        header_photo_size: 64,
        header_photo_position: layout === "horizon-rail" || layout === "mosaic-columns" ? "center" : "right",
        header_alignment: layout === "mosaic-columns" ? "center" : "left",
        header_background_hex: dark ? palette.ink : filled ? palette.surface : "#ffffff",
        header_text_color_hex: dark ? "#ffffff" : palette.ink,
        header_accent_color_hex: dark ? palette.highlight : palette.accent,
        header_muted_color_hex: dark ? "#e8edf2" : "#526071",
        surface_color_hex: palette.surface,
        heading_color_hex: palette.ink, accent_color_hex: palette.accent,
        body_color_hex: "#293442", muted_color_hex: "#526071", page_background_hex: "#ffffff",
        section_heading_style: layout === "ledger-split" ? "ruled" : "plain",
        section_spacing: layout === "contour-cards" ? 10 : layout === "ledger-split" ? 12 : 16,
        block_spacing: layout === "ledger-split" || layout === "contour-cards" ? 8 : 10,
        body_text_size: layout === "ledger-split" || layout === "contour-cards" ? 11 : 12,
        compact_density: true
      }
    } satisfies TemplateProfile];
  })
);

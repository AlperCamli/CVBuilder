import horizon from "../../../assets/template-showcase/horizon-rail.webp";
import studio from "../../../assets/template-showcase/studio-banner-ocean.webp";
import rose from "../../../assets/template-showcase/mosaic-columns-rose.webp";
import editorial from "../../../assets/template-showcase/editorial-index-graphite.webp";
import mosaic from "../../../assets/template-showcase/mosaic-columns-graphite.webp";
import ledger from "../../../assets/template-showcase/ledger-split.webp";
import academic from "../../../assets/template-showcase/latex-academic-serif.webp";

// Slugs are the real catalog identifiers. Previews come from the PDF exporter.
export const SHOWCASE_TEMPLATES = [
  {
    slug: "horizon-rail",
    name: "Horizon",
    color: "Navy & gold",
    detail: "A bold sidebar. A clear direction.",
    image: horizon,
    ink: "#172b46",
    accent: "#efb65f",
    surface: "#e8edf2",
    family: "Two column",
  },
  {
    slug: "studio-banner-ocean",
    name: "Studio Ocean",
    color: "Ocean blue",
    detail: "An expressive header that makes an entrance.",
    image: studio,
    ink: "#123852",
    accent: "#a0ddf0",
    surface: "#e4eff3",
    family: "Statement header",
  },
  {
    slug: "mosaic-columns-rose",
    name: "Mosaic Rose",
    color: "Soft rose",
    detail: "A little color. Beautifully balanced.",
    image: rose,
    ink: "#50243e",
    accent: "#f6b6d0",
    surface: "#f5e8ee",
    family: "Two column",
  },
  {
    slug: "editorial-index-graphite",
    name: "Editorial Graphite",
    color: "Graphite",
    detail: "Thoughtful typography. An editorial point of view.",
    image: editorial,
    ink: "#292e38",
    accent: "#b4becb",
    surface: "#e9ebef",
    family: "Editorial",
  },
  {
    slug: "mosaic-columns-graphite",
    name: "Mosaic Graphite",
    color: "Cool grey",
    detail: "A structured layout with room for your story.",
    image: mosaic,
    ink: "#292e38",
    accent: "#d6dce6",
    surface: "#eceef0",
    family: "Two column",
  },
  {
    slug: "ledger-split",
    name: "Ledger",
    color: "Warm terracotta",
    detail: "A considered timeline. Every chapter in place.",
    image: ledger,
    ink: "#572c27",
    accent: "#ffc2a8",
    surface: "#f4e9e2",
    family: "Timeline",
  },
  {
    slug: "latex-academic-serif",
    name: "Academic Serif",
    color: "Classic monochrome",
    detail: "Timeless serif type. Let your experience speak.",
    image: academic,
    ink: "#262626",
    accent: "#c6beaf",
    surface: "#eeeae2",
    family: "Classic serif",
  },
] as const;

export const SHOWCASE_DIRECTIONS = [
  {
    id: "collection",
    name: "Collection",
    description: "Compare the whole collection at a glance.",
  },
  {
    id: "spotlight",
    name: "Spotlight",
    description: "Explore one template in detail, then try another.",
  },
  {
    id: "lookbook",
    name: "Lookbook",
    description: "Browse a layered, colorful carousel.",
  },
] as const;
export type ShowcaseDirection = (typeof SHOWCASE_DIRECTIONS)[number]["id"];
export type ShowcaseTemplate = (typeof SHOWCASE_TEMPLATES)[number];
export const showcasePath = (direction: string) =>
  `/designs/guided-journey/templates/${direction}`;

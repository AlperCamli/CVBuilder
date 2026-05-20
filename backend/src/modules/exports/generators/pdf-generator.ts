import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type {
  ExportDocumentBlock,
  ExportDocumentModel,
  ExportDocumentSection
} from "./rendering-document.mapper";
import type { ExportScales } from "./rendering-export-generator";

// A4 in PDF points. Matches the preview's PAGE_WIDTH_PX / PAGE_HEIGHT_PX so block heights
// computed here line up with what the on-screen preview measures.
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

const TWO_COLUMN_GAP = 20;
const SIDEBAR_OUTER_WIDTH = 170;
const SIDEBAR_INNER_PADDING = 12;
const HEADER_PHOTO_GAP = 16;

const SIDEBAR_SECTION_TYPES = new Set([
  "skills",
  "languages",
  "references",
  "certifications",
  "courses"
]);

// pdf-lib draws text relative to its baseline; we model a block top-down and convert to
// baseline via this ascent fraction. 0.8 is a reasonable approximation for Noto Sans and
// keeps the visible top of the glyphs roughly at the block's top edge.
const ASCENT_RATIO = 0.8;

type RgbColor = ReturnType<typeof rgb>;
type ColorKey = "heading" | "accent" | "body" | "muted";
type ColumnKind = "full" | "sidebar" | "main";

interface PdfPalette {
  heading: RgbColor;
  accent: RgbColor;
  body: RgbColor;
  muted: RgbColor;
}

interface PdfFonts {
  regular: PDFFont;
  bold: PDFFont;
}

interface PlacedLine {
  text: string;
  fontWeight: "regular" | "bold";
  size: number;
  colorKey: ColorKey;
  xOffset: number;
  yFromTop: number;
  lineHeight: number;
  alignRight?: boolean;
  alignBoxWidth?: number;
}

interface PlacedShape {
  kind: "horizontal-line" | "vertical-line" | "circle";
  xOffset: number;
  yFromTop: number;
  width?: number;
  height?: number;
  radius?: number;
  colorKey: ColorKey;
  opacity?: number;
  thickness?: number;
}

interface PlacedImage {
  xOffset: number;
  yFromTop: number;
  width: number;
  height: number;
  imageRef: PDFImage;
}

interface BlockShape {
  lines: PlacedLine[];
  shapes: PlacedShape[];
  images: PlacedImage[];
  height: number;
}

interface PdfBlock {
  key: string;
  column: ColumnKind;
  keepWithNext?: boolean;
  shape: BlockShape;
}

interface Style {
  fontScale: number;
  spacingScale: number;
  layoutScale: number;
  padX: number;
  padY: number;
  innerWidth: number;
  innerHeight: number;
  blockSpacing: number;
  sectionSpacing: number;
  sidebarBlockSpacing: number;
  sidebarSectionSpacing: number;
  headerNameSize: number;
  headerTitleSize: number;
  headerContactSize: number;
  sectionTitleSize: number;
  itemTitleSize: number;
  itemSubtitleSize: number;
  itemMetaSize: number;
  itemBodySize: number;
  bulletSize: number;
  timelineDateSize: number;
  photoSize: number;
  sidebarInnerWidth: number;
  mainColumnWidth: number;
  fonts: PdfFonts;
  palette: PdfPalette;
  sidebarPalette: PdfPalette;
}

// ---------------------------------------------------------------------------
// Text utilities
// ---------------------------------------------------------------------------

export const normalizePdfText = (value: string): string => value.replace(/\s+/g, " ").trim();

const wrapText = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
  const normalized = normalizePdfText(text);
  if (!normalized) {
    return [];
  }

  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current.length === 0 ? word : `${current} ${word}`;

    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      lines.push(current);
    }

    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }

    let remaining = word;
    while (remaining.length > 0) {
      let take = remaining.length;
      while (take > 1 && font.widthOfTextAtSize(remaining.slice(0, take), size) > maxWidth) {
        take -= 1;
      }
      lines.push(remaining.slice(0, take));
      remaining = remaining.slice(take);
    }

    current = "";
  }

  if (current.length > 0) {
    lines.push(current);
  }

  return lines;
};

const wrapMultiline = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
  const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    lines.push(...wrapText(paragraph, font, size, maxWidth));
  }
  return lines;
};

const hexToRgb = (hex: string): RgbColor => {
  const normalized = hex.trim().replace(/^#/, "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;

  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) {
    return rgb(0, 0, 0);
  }

  const intValue = Number.parseInt(expanded, 16);
  const r = (intValue >> 16) & 255;
  const g = (intValue >> 8) & 255;
  const b = intValue & 255;
  return rgb(r / 255, g / 255, b / 255);
};

const tryReadFontBytes = (fileName: string): Uint8Array => {
  const candidates = [
    resolve(process.cwd(), "assets", "fonts", fileName),
    resolve(process.cwd(), "backend", "assets", "fonts", fileName)
  ];

  for (const candidate of candidates) {
    try {
      const bytes = readFileSync(candidate);
      return new Uint8Array(bytes);
    } catch {
      // try next path
    }
  }

  throw new Error(`Font file not found: ${fileName}`);
};

const parseDataUriImage = (dataUri: string): { mimeType: "image/png" | "image/jpeg"; bytes: Uint8Array } | null => {
  const match = dataUri.match(/^data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    return null;
  }

  const mimeType = match[1].toLowerCase() === "image/png" ? "image/png" : "image/jpeg";
  const bytes = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  return { mimeType, bytes: new Uint8Array(bytes) };
};

// Adds wrapped text into a shape and returns the height consumed (lines * lineHeight).
const appendTextLines = (
  target: PlacedLine[],
  text: string,
  options: {
    font: PDFFont;
    fontWeight: "regular" | "bold";
    size: number;
    color: ColorKey;
    maxWidth: number;
    xOffset: number;
    yFromTop: number;
    lineHeight: number;
    alignRight?: boolean;
    alignBoxWidth?: number;
  }
): number => {
  const wrapped = wrapMultiline(text, options.font, options.size, options.maxWidth);
  for (let i = 0; i < wrapped.length; i++) {
    target.push({
      text: wrapped[i],
      fontWeight: options.fontWeight,
      size: options.size,
      colorKey: options.color,
      xOffset: options.xOffset,
      yFromTop: options.yFromTop + i * options.lineHeight,
      lineHeight: options.lineHeight,
      alignRight: options.alignRight,
      alignBoxWidth: options.alignBoxWidth
    });
  }
  return wrapped.length * options.lineHeight;
};

// ---------------------------------------------------------------------------
// Block builders — each returns a BlockShape with absolute heights/positions
// relative to the block's own (left=0, top=0) origin.
// ---------------------------------------------------------------------------

const buildHeaderBlock = (
  model: ExportDocumentModel,
  style: Style,
  photo: PDFImage | null
): BlockShape => {
  const lines: PlacedLine[] = [];
  const images: PlacedImage[] = [];

  const textX = photo ? style.photoSize + HEADER_PHOTO_GAP : 0;
  const textMaxWidth = style.innerWidth - textX;

  if (photo) {
    images.push({
      xOffset: 0,
      yFromTop: 0,
      width: style.photoSize,
      height: style.photoSize,
      imageRef: photo
    });
  }

  const nameLH = style.headerNameSize * 1.2;
  const titleLH = style.headerTitleSize * 1.4;
  const contactLH = style.headerContactSize * 1.55;

  let textY = 0;
  textY += appendTextLines(lines, model.title, {
    font: style.fonts.bold,
    fontWeight: "bold",
    size: style.headerNameSize,
    color: "heading",
    maxWidth: textMaxWidth,
    xOffset: textX,
    yFromTop: textY,
    lineHeight: nameLH
  });

  if (model.subtitle) {
    textY += 2 * style.fontScale;
    textY += appendTextLines(lines, model.subtitle, {
      font: style.fonts.regular,
      fontWeight: "regular",
      size: style.headerTitleSize,
      color: "accent",
      maxWidth: textMaxWidth,
      xOffset: textX,
      yFromTop: textY,
      lineHeight: titleLH
    });
  }

  if (model.contact_line) {
    textY += 6 * style.fontScale;
    textY += appendTextLines(lines, model.contact_line, {
      font: style.fonts.regular,
      fontWeight: "regular",
      size: style.headerContactSize,
      color: "muted",
      maxWidth: textMaxWidth,
      xOffset: textX,
      yFromTop: textY,
      lineHeight: contactLH
    });
  }

  if (model.social_links.length > 0) {
    textY += 8 * style.fontScale;
    textY += appendTextLines(lines, model.social_links.map((link) => link.label).join(" • "), {
      font: style.fonts.regular,
      fontWeight: "regular",
      size: style.headerContactSize,
      color: "muted",
      maxWidth: textMaxWidth,
      xOffset: textX,
      yFromTop: textY,
      lineHeight: contactLH
    });
  }

  const height = photo ? Math.max(textY, style.photoSize) : textY;
  return { lines, shapes: [], images, height };
};

const buildHeaderDividerBlock = (style: Style): BlockShape => {
  const topGap = 12 * style.fontScale;
  const bottomGap = 14 * style.fontScale;
  return {
    lines: [],
    shapes: [
      {
        kind: "horizontal-line",
        xOffset: 0,
        yFromTop: topGap,
        width: style.innerWidth,
        colorKey: "muted",
        opacity: 0.2,
        thickness: 0.7
      }
    ],
    images: [],
    height: topGap + 1 + bottomGap
  };
};

const buildSectionTitleBlock = (
  title: string,
  width: number,
  style: Style,
  isSidebar: boolean
): BlockShape => {
  const lines: PlacedLine[] = [];
  const titleLH = style.sectionTitleSize * 1.3;
  const marginBottom = 8 * style.fontScale;

  const totalLines = appendTextLines(lines, title, {
    font: style.fonts.bold,
    fontWeight: "bold",
    size: style.sectionTitleSize,
    color: isSidebar ? "accent" : "heading",
    maxWidth: width,
    xOffset: 0,
    yFromTop: 0,
    lineHeight: titleLH
  });

  return { lines, shapes: [], images: [], height: totalLines + marginBottom };
};

const buildInlineParagraphBlock = (
  text: string,
  width: number,
  style: Style,
  trailingMargin: number
): BlockShape => {
  const lines: PlacedLine[] = [];
  const bodyLH = style.itemBodySize * 1.6;
  const consumed = appendTextLines(lines, text, {
    font: style.fonts.regular,
    fontWeight: "regular",
    size: style.itemBodySize,
    color: "body",
    maxWidth: width,
    xOffset: 0,
    yFromTop: 0,
    lineHeight: bodyLH
  });

  return { lines, shapes: [], images: [], height: consumed + trailingMargin };
};

const buildDefaultItemBlock = (
  item: ExportDocumentBlock,
  width: number,
  style: Style,
  trailingMargin: number
): BlockShape => {
  const lines: PlacedLine[] = [];
  const hasInlineMeta = Boolean(item.metadata_line && (item.headline || item.subheadline));
  const metaWidth = hasInlineMeta ? Math.min(110 * style.fontScale, width * 0.4) : 0;
  const metaGap = hasInlineMeta ? 12 : 0;
  const leftWidth = width - metaWidth - metaGap;

  const titleLH = style.itemTitleSize * 1.25;
  const subtitleLH = style.itemSubtitleSize * 1.4;
  const metaLH = style.itemMetaSize * 1.4;
  const bodyLH = style.itemBodySize * 1.6;
  const bulletLH = style.bulletSize * 1.5;

  let leftY = 0;
  if (item.headline) {
    leftY += appendTextLines(lines, item.headline, {
      font: style.fonts.bold,
      fontWeight: "bold",
      size: style.itemTitleSize,
      color: "heading",
      maxWidth: leftWidth,
      xOffset: 0,
      yFromTop: leftY,
      lineHeight: titleLH
    });
  }
  if (item.subheadline) {
    leftY += appendTextLines(lines, item.subheadline, {
      font: style.fonts.regular,
      fontWeight: "regular",
      size: style.itemSubtitleSize,
      color: "body",
      maxWidth: leftWidth,
      xOffset: 0,
      yFromTop: leftY,
      lineHeight: subtitleLH
    });
  }

  let rightY = 0;
  if (hasInlineMeta && item.metadata_line) {
    rightY += appendTextLines(lines, item.metadata_line, {
      font: style.fonts.regular,
      fontWeight: "regular",
      size: style.itemMetaSize,
      color: "muted",
      maxWidth: metaWidth,
      xOffset: leftWidth + metaGap,
      yFromTop: 0,
      lineHeight: metaLH,
      alignRight: true,
      alignBoxWidth: metaWidth
    });
  }

  let cursorY = Math.max(leftY, rightY);

  if (item.metadata_line && !hasInlineMeta) {
    cursorY += appendTextLines(lines, item.metadata_line, {
      font: style.fonts.regular,
      fontWeight: "regular",
      size: style.itemMetaSize,
      color: "muted",
      maxWidth: width,
      xOffset: 0,
      yFromTop: cursorY,
      lineHeight: metaLH
    });
  }

  if (item.bullets.length > 0) {
    cursorY += 4 * style.fontScale;
    const bulletIndent = 14 * style.fontScale;
    for (const bullet of item.bullets) {
      cursorY += appendTextLines(lines, `• ${bullet}`, {
        font: style.fonts.regular,
        fontWeight: "regular",
        size: style.bulletSize,
        color: "body",
        maxWidth: width - bulletIndent,
        xOffset: bulletIndent,
        yFromTop: cursorY,
        lineHeight: bulletLH
      });
    }
  } else if (item.body) {
    cursorY += 4 * style.fontScale;
    cursorY += appendTextLines(lines, item.body, {
      font: style.fonts.regular,
      fontWeight: "regular",
      size: style.itemBodySize,
      color: "body",
      maxWidth: width,
      xOffset: 0,
      yFromTop: cursorY,
      lineHeight: bodyLH
    });
  }

  return { lines, shapes: [], images: [], height: cursorY + trailingMargin };
};

const buildTimelineItemBlock = (
  item: ExportDocumentBlock,
  width: number,
  style: Style,
  trailingMargin: number
): BlockShape => {
  const lines: PlacedLine[] = [];
  const shapes: PlacedShape[] = [];

  const dateColWidth = Math.min(110 * style.fontScale, width * 0.32);
  const columnGap = 12 * style.fontScale;
  const contentColX = dateColWidth + columnGap;
  const dotIndent = 16 * style.fontScale;
  const contentTextX = contentColX + dotIndent;
  const contentTextWidth = Math.max(40, width - contentTextX);

  const titleLH = style.itemTitleSize * 1.25;
  const subtitleLH = style.itemSubtitleSize * 1.4;
  const metaLH = style.itemMetaSize * 1.4;
  const bodyLH = style.itemBodySize * 1.6;
  const bulletLH = style.bulletSize * 1.5;

  let dateY = 2 * style.fontScale;
  const dateText = item.metadata_line ?? "";
  if (dateText) {
    dateY += appendTextLines(lines, dateText, {
      font: style.fonts.regular,
      fontWeight: "regular",
      size: style.timelineDateSize,
      color: "muted",
      maxWidth: dateColWidth,
      xOffset: 0,
      yFromTop: dateY,
      lineHeight: metaLH
    });
  }

  let contentY = 0;
  if (item.headline) {
    contentY += appendTextLines(lines, item.headline, {
      font: style.fonts.bold,
      fontWeight: "bold",
      size: style.itemTitleSize,
      color: "heading",
      maxWidth: contentTextWidth,
      xOffset: contentTextX,
      yFromTop: contentY,
      lineHeight: titleLH
    });
  }
  if (item.subheadline) {
    contentY += appendTextLines(lines, item.subheadline, {
      font: style.fonts.regular,
      fontWeight: "regular",
      size: style.itemSubtitleSize,
      color: "body",
      maxWidth: contentTextWidth,
      xOffset: contentTextX,
      yFromTop: contentY,
      lineHeight: subtitleLH
    });
  }
  if (item.bullets.length > 0) {
    contentY += 4 * style.fontScale;
    const bulletIndent = 12 * style.fontScale;
    for (const bullet of item.bullets) {
      contentY += appendTextLines(lines, `• ${bullet}`, {
        font: style.fonts.regular,
        fontWeight: "regular",
        size: style.bulletSize,
        color: "body",
        maxWidth: contentTextWidth - bulletIndent,
        xOffset: contentTextX + bulletIndent,
        yFromTop: contentY,
        lineHeight: bulletLH
      });
    }
  } else if (item.body) {
    contentY += 4 * style.fontScale;
    contentY += appendTextLines(lines, item.body, {
      font: style.fonts.regular,
      fontWeight: "regular",
      size: style.itemBodySize,
      color: "body",
      maxWidth: contentTextWidth,
      xOffset: contentTextX,
      yFromTop: contentY,
      lineHeight: bodyLH
    });
  }

  const totalHeight = Math.max(dateY, contentY);
  const dotY = 4 * style.fontScale;
  const dotRadius = 3 * style.fontScale;
  shapes.push({
    kind: "circle",
    xOffset: contentColX + dotRadius,
    yFromTop: dotY,
    radius: dotRadius,
    colorKey: "accent"
  });
  if (totalHeight > dotY + dotRadius * 2 + 2) {
    shapes.push({
      kind: "vertical-line",
      xOffset: contentColX + dotRadius,
      yFromTop: dotY + dotRadius * 2,
      height: totalHeight - dotY - dotRadius * 2,
      colorKey: "accent",
      opacity: 0.35,
      thickness: 1
    });
  }

  return { lines, shapes, images: [], height: totalHeight + trailingMargin };
};

const buildSectionBlocks = (
  section: ExportDocumentSection,
  width: number,
  style: Style,
  options: {
    column: ColumnKind;
    keyPrefix: string;
    isTimeline: boolean;
    blockSpacing: number;
    sectionSpacing: number;
    isSidebar: boolean;
  }
): PdfBlock[] => {
  const { column, keyPrefix, isTimeline, blockSpacing, sectionSpacing, isSidebar } = options;
  const blocks: PdfBlock[] = [];
  const sectionId = `${keyPrefix}sec-${section.title}-${section.type}`;

  if (section.blocks.length === 0) {
    // Title + optional inline text bundled as one indivisible block.
    const lines: PlacedLine[] = [];
    const titleLH = style.sectionTitleSize * 1.3;
    let y = 0;
    y += appendTextLines(lines, section.title, {
      font: style.fonts.bold,
      fontWeight: "bold",
      size: style.sectionTitleSize,
      color: isSidebar ? "accent" : "heading",
      maxWidth: width,
      xOffset: 0,
      yFromTop: y,
      lineHeight: titleLH
    });
    if (section.inline_text) {
      y += 8 * style.fontScale;
      const bodyLH = style.itemBodySize * 1.6;
      y += appendTextLines(lines, section.inline_text, {
        font: style.fonts.regular,
        fontWeight: "regular",
        size: style.itemBodySize,
        color: "body",
        maxWidth: width,
        xOffset: 0,
        yFromTop: y,
        lineHeight: bodyLH
      });
    }
    blocks.push({
      key: `${sectionId}-bundled`,
      column,
      shape: { lines, shapes: [], images: [], height: y + sectionSpacing }
    });
    return blocks;
  }

  blocks.push({
    key: `${sectionId}-title`,
    column,
    keepWithNext: true,
    shape: buildSectionTitleBlock(section.title, width, style, isSidebar)
  });

  if (section.inline_text) {
    blocks.push({
      key: `${sectionId}-inline`,
      column,
      keepWithNext: true,
      shape: buildInlineParagraphBlock(section.inline_text, width, style, blockSpacing)
    });
  }

  section.blocks.forEach((item, index) => {
    const isLast = index === section.blocks.length - 1;
    const trailing = isLast ? sectionSpacing : blockSpacing;
    const shape = isTimeline
      ? buildTimelineItemBlock(item, width, style, trailing)
      : buildDefaultItemBlock(item, width, style, trailing);
    blocks.push({
      key: `${sectionId}-item-${index}`,
      column,
      shape
    });
  });

  return blocks;
};

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

const paginateBlocks = (
  blocks: PdfBlock[],
  availableHeights: number[]
): PdfBlock[][] => {
  if (blocks.length === 0) {
    return [];
  }

  const pages: PdfBlock[][] = [[]];
  let cursorY = 0;

  const getAvailable = (pageIndex: number): number => {
    if (availableHeights.length === 0) {
      return Number.POSITIVE_INFINITY;
    }
    const idx = Math.min(pageIndex, availableHeights.length - 1);
    return availableHeights[idx];
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const blockHeight = block.shape.height;
    const pageIdx = pages.length - 1;
    const available = getAvailable(pageIdx);

    let neededHeight = blockHeight;
    if (block.keepWithNext && i + 1 < blocks.length) {
      const nextHeight = blocks[i + 1].shape.height;
      neededHeight = Math.min(available, blockHeight + nextHeight);
    }

    const pageHasContent = pages[pageIdx].length > 0;
    const wouldOverflow = cursorY + neededHeight > available + 0.5;

    if (wouldOverflow && pageHasContent) {
      pages.push([]);
      cursorY = 0;
    }

    pages[pages.length - 1].push(block);
    cursorY += blockHeight;
  }

  return pages;
};

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

const resolveColor = (palette: PdfPalette, key: ColorKey): RgbColor => {
  switch (key) {
    case "heading":
      return palette.heading;
    case "accent":
      return palette.accent;
    case "body":
      return palette.body;
    case "muted":
      return palette.muted;
  }
};

const drawBlock = (
  page: PDFPage,
  block: PdfBlock,
  leftX: number,
  topY: number,
  style: Style
): void => {
  const palette = block.column === "sidebar" ? style.sidebarPalette : style.palette;

  for (const image of block.shape.images) {
    page.drawImage(image.imageRef, {
      x: leftX + image.xOffset,
      y: topY - image.yFromTop - image.height,
      width: image.width,
      height: image.height
    });
  }

  for (const line of block.shape.lines) {
    const font = line.fontWeight === "bold" ? style.fonts.bold : style.fonts.regular;
    const baselineY = topY - line.yFromTop - line.lineHeight * ASCENT_RATIO;
    let drawX = leftX + line.xOffset;
    if (line.alignRight && line.alignBoxWidth) {
      const lineWidth = font.widthOfTextAtSize(line.text, line.size);
      drawX = leftX + line.xOffset + Math.max(0, line.alignBoxWidth - lineWidth);
    }
    page.drawText(line.text, {
      x: drawX,
      y: baselineY,
      size: line.size,
      font,
      color: resolveColor(palette, line.colorKey)
    });
  }

  for (const shape of block.shape.shapes) {
    const color = resolveColor(palette, shape.colorKey);
    if (shape.kind === "horizontal-line") {
      const y = topY - shape.yFromTop;
      page.drawLine({
        start: { x: leftX + shape.xOffset, y },
        end: { x: leftX + shape.xOffset + (shape.width ?? 0), y },
        color,
        thickness: shape.thickness ?? 0.7,
        opacity: shape.opacity ?? 1
      });
    } else if (shape.kind === "vertical-line") {
      const xPos = leftX + shape.xOffset;
      page.drawLine({
        start: { x: xPos, y: topY - shape.yFromTop },
        end: { x: xPos, y: topY - shape.yFromTop - (shape.height ?? 0) },
        color,
        thickness: shape.thickness ?? 1,
        opacity: shape.opacity ?? 1
      });
    } else if (shape.kind === "circle") {
      page.drawCircle({
        x: leftX + shape.xOffset,
        y: topY - shape.yFromTop - (shape.radius ?? 2),
        size: shape.radius ?? 2,
        color,
        opacity: shape.opacity ?? 1
      });
    }
  }
};

const drawSidebarCard = (
  page: PDFPage,
  style: Style,
  leftX: number,
  topY: number,
  width: number,
  height: number
): void => {
  const accent = style.palette.accent;
  // pdf-lib's PDFPage doesn't support drawRectangle background alpha + border in one call;
  // draw a faint fill then an outline approximation via a rectangle.
  page.drawRectangle({
    x: leftX,
    y: topY - height,
    width,
    height,
    color: accent,
    opacity: 0.05,
    borderColor: accent,
    borderOpacity: 0.18,
    borderWidth: 0.5
  });
};

// ---------------------------------------------------------------------------
// Top-level generator
// ---------------------------------------------------------------------------

export const generatePdfDocument = async (
  documentModel: ExportDocumentModel,
  scales: ExportScales = { font_scale: 1, spacing_scale: 1, layout_scale: 1 }
): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const regularFontBytes = tryReadFontBytes("NotoSans-Regular.ttf");
  const boldFontBytes = tryReadFontBytes("NotoSans-Bold.ttf");
  const regular = await pdf.embedFont(regularFontBytes, { subset: false });
  const bold = await pdf.embedFont(boldFontBytes, { subset: false });

  const theme = documentModel.theme;
  const palette: PdfPalette = {
    heading: hexToRgb(theme.heading_color_hex),
    accent: hexToRgb(theme.accent_color_hex),
    body: hexToRgb(theme.body_color_hex),
    muted: hexToRgb(theme.muted_color_hex)
  };
  // Sidebar inherits a palette where "heading" is rendered with the accent color, matching
  // the preview's renderDefaultSection(... { heading: colors.accent }) for two-column mode.
  const sidebarPalette: PdfPalette = { ...palette, heading: palette.accent };

  const fontScale = scales.font_scale;
  const spacingScale = scales.spacing_scale;
  const layoutScale = scales.layout_scale;

  // Margins mirror CVPresentationPreview: compact mode is tighter, all margins scale with layoutScale.
  const basePadY = theme.mode === "compact-single-column" ? 38 : 46;
  const basePadX = theme.mode === "compact-single-column" ? 34 : 38;
  const padY = basePadY * layoutScale;
  const padX = basePadX * layoutScale;
  const innerWidth = PAGE_WIDTH - padX * 2;
  const innerHeight = PAGE_HEIGHT - padY * 2;

  const sidebarOuterWidth = SIDEBAR_OUTER_WIDTH * fontScale;
  const sidebarInnerPaddingScaled = SIDEBAR_INNER_PADDING * fontScale;
  const sidebarInnerWidth = Math.max(0, sidebarOuterWidth - sidebarInnerPaddingScaled * 2);
  const mainColumnWidth = Math.max(0, innerWidth - sidebarOuterWidth - TWO_COLUMN_GAP);

  const style: Style = {
    fontScale,
    spacingScale,
    layoutScale,
    padX,
    padY,
    innerWidth,
    innerHeight,
    blockSpacing: theme.block_spacing * spacingScale,
    sectionSpacing: theme.section_spacing * spacingScale,
    sidebarBlockSpacing: Math.max(6, theme.block_spacing * spacingScale - 3),
    sidebarSectionSpacing: Math.max(10, theme.section_spacing * spacingScale - 3),
    headerNameSize: (theme.mode === "compact-single-column" ? 21 : 23) * fontScale,
    headerTitleSize: 14 * fontScale,
    headerContactSize: 11 * fontScale,
    sectionTitleSize: 14 * fontScale,
    itemTitleSize: 13 * fontScale,
    itemSubtitleSize: 12 * fontScale,
    itemMetaSize: 11 * fontScale,
    itemBodySize: 12 * fontScale,
    bulletSize: 12 * fontScale,
    timelineDateSize: 11 * fontScale,
    photoSize: 58 * fontScale,
    sidebarInnerWidth,
    mainColumnWidth,
    fonts: { regular, bold },
    palette,
    sidebarPalette
  };

  // Embed photo once and reuse across pages.
  let photoImage: PDFImage | null = null;
  if (documentModel.photo_data_uri) {
    const parsed = parseDataUriImage(documentModel.photo_data_uri);
    if (parsed) {
      photoImage =
        parsed.mimeType === "image/png"
          ? await pdf.embedPng(parsed.bytes)
          : await pdf.embedJpg(parsed.bytes);
    }
  }

  const isTwoColumn = theme.mode === "portfolio-two-column";
  const isTimeline = theme.mode === "timeline-split";

  // Build block lists. The header block list (header text + divider) is always full-width.
  const headerBlock: PdfBlock = {
    key: "header",
    column: "full",
    shape: buildHeaderBlock(documentModel, style, photoImage)
  };
  const headerDividerBlock: PdfBlock = {
    key: "header-divider",
    column: "full",
    shape: buildHeaderDividerBlock(style)
  };
  const headerBlocks: PdfBlock[] = [headerBlock, headerDividerBlock];
  const headerTotalHeight = headerBlocks.reduce((sum, block) => sum + block.shape.height, 0);

  let singlePages: PdfBlock[][] = [];
  let sidebarPages: PdfBlock[][] = [];
  let mainPages: PdfBlock[][] = [];

  if (isTwoColumn) {
    const sidebarSections = documentModel.sections.filter((s) => SIDEBAR_SECTION_TYPES.has(s.type));
    const mainSections = documentModel.sections.filter((s) => !SIDEBAR_SECTION_TYPES.has(s.type));

    const sidebarBlocks: PdfBlock[] = sidebarSections.flatMap((section, sectionIndex) =>
      buildSectionBlocks(section, sidebarInnerWidth, style, {
        column: "sidebar",
        keyPrefix: `sb-${sectionIndex}-`,
        isTimeline: false,
        blockSpacing: style.sidebarBlockSpacing,
        sectionSpacing: style.sidebarSectionSpacing,
        isSidebar: true
      })
    );

    const mainBlocks: PdfBlock[] = mainSections.flatMap((section, sectionIndex) =>
      buildSectionBlocks(section, mainColumnWidth, style, {
        column: "main",
        keyPrefix: `mn-${sectionIndex}-`,
        isTimeline: false,
        blockSpacing: style.blockSpacing,
        sectionSpacing: style.sectionSpacing,
        isSidebar: false
      })
    );

    const sidebarPadConsumed = sidebarInnerPaddingScaled * 2;
    const sidebarPage1Available = Math.max(0, innerHeight - headerTotalHeight - sidebarPadConsumed);
    const sidebarPageNAvailable = Math.max(0, innerHeight - sidebarPadConsumed);
    const mainPage1Available = Math.max(0, innerHeight - headerTotalHeight);
    const mainPageNAvailable = innerHeight;

    sidebarPages = paginateBlocks(sidebarBlocks, [sidebarPage1Available, sidebarPageNAvailable]);
    mainPages = paginateBlocks(mainBlocks, [mainPage1Available, mainPageNAvailable]);
  } else {
    const singleBlocks: PdfBlock[] = documentModel.sections.flatMap((section, sectionIndex) =>
      buildSectionBlocks(section, innerWidth, style, {
        column: "full",
        keyPrefix: `s-${sectionIndex}-`,
        isTimeline,
        blockSpacing: style.blockSpacing,
        sectionSpacing: style.sectionSpacing,
        isSidebar: false
      })
    );
    const combined: PdfBlock[] = [...headerBlocks, ...singleBlocks];
    singlePages = paginateBlocks(combined, [innerHeight]);
  }

  const pageCount = isTwoColumn
    ? Math.max(sidebarPages.length, mainPages.length, 1)
    : Math.max(singlePages.length, 1);

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

    // Background fill (matches preview's page_background_hex).
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: hexToRgb(theme.page_background_hex)
    });

    const pageTopY = PAGE_HEIGHT - padY;
    const pageLeftX = padX;

    if (isTwoColumn) {
      let cursorY = pageTopY;

      if (pageIndex === 0) {
        for (const block of headerBlocks) {
          drawBlock(page, block, pageLeftX, cursorY, style);
          cursorY -= block.shape.height;
        }
      }

      const sidebarBlocksOnPage = sidebarPages[pageIndex] ?? [];
      const mainBlocksOnPage = mainPages[pageIndex] ?? [];

      const sidebarHeight = sidebarBlocksOnPage.reduce((sum, block) => sum + block.shape.height, 0);
      const sidebarCardHeight = sidebarHeight + sidebarInnerPaddingScaled * 2;
      if (sidebarBlocksOnPage.length > 0) {
        drawSidebarCard(page, style, pageLeftX, cursorY, sidebarOuterWidth, sidebarCardHeight);
      }

      let sidebarCursorY = cursorY - sidebarInnerPaddingScaled;
      for (const block of sidebarBlocksOnPage) {
        drawBlock(page, block, pageLeftX + sidebarInnerPaddingScaled, sidebarCursorY, style);
        sidebarCursorY -= block.shape.height;
      }

      let mainCursorY = cursorY;
      for (const block of mainBlocksOnPage) {
        drawBlock(page, block, pageLeftX + sidebarOuterWidth + TWO_COLUMN_GAP, mainCursorY, style);
        mainCursorY -= block.shape.height;
      }
    } else {
      let cursorY = pageTopY;
      const blocksOnPage = singlePages[pageIndex] ?? [];
      for (const block of blocksOnPage) {
        drawBlock(page, block, pageLeftX, cursorY, style);
        cursorY -= block.shape.height;
      }
    }
  }

  const bytes = await pdf.save();
  return bytes;
};

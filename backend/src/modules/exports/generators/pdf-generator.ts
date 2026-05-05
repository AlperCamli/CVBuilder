import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import type { ExportDocumentModel, ExportDocumentSection } from "./rendering-document.mapper";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 42;

interface DrawContext {
  page: PDFPage;
  cursorY: number;
}

interface DrawWrappedTextOptions {
  text: string;
  font: PDFFont;
  size: number;
  color: ReturnType<typeof rgb>;
  lineHeight: number;
  maxWidth: number;
  x: number;
  leadingGap?: number;
}

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

const hexToRgb = (hex: string): ReturnType<typeof rgb> => {
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

  return {
    mimeType,
    bytes: new Uint8Array(bytes)
  };
};

const drawDivider = (page: PDFPage, y: number, color: ReturnType<typeof rgb>) => {
  page.drawLine({
    start: { x: PAGE_MARGIN, y },
    end: { x: PAGE_WIDTH - PAGE_MARGIN, y },
    color,
    thickness: 0.6,
    opacity: 0.4
  });
};

const renderSectionDefault = (
  section: ExportDocumentSection,
  drawContext: DrawContext,
  ensureSpace: (requiredHeight: number) => void,
  drawWrappedText: (options: DrawWrappedTextOptions) => void,
  fonts: { regular: PDFFont; bold: PDFFont },
  colors: {
    heading: ReturnType<typeof rgb>;
    body: ReturnType<typeof rgb>;
    muted: ReturnType<typeof rgb>;
  },
  bodyFontSize: number,
  blockSpacing: number
): void => {
  ensureSpace(24);
  drawWrappedText({
    text: section.title,
    font: fonts.bold,
    size: bodyFontSize + 1,
    color: colors.heading,
    lineHeight: bodyFontSize + 5,
    maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
    x: PAGE_MARGIN
  });

  if (section.inline_text) {
    drawWrappedText({
      text: section.inline_text,
      font: fonts.regular,
      size: bodyFontSize,
      color: colors.body,
      lineHeight: bodyFontSize + 4,
      maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
      x: PAGE_MARGIN
    });
    drawContext.cursorY -= blockSpacing;
    return;
  }

  for (const block of section.blocks) {
    if (block.headline) {
      drawWrappedText({
        text: block.headline,
        font: fonts.bold,
        size: bodyFontSize,
        color: colors.body,
        lineHeight: bodyFontSize + 4,
        maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
        x: PAGE_MARGIN
      });
    }

    if (block.subheadline) {
      drawWrappedText({
        text: block.subheadline,
        font: fonts.regular,
        size: bodyFontSize - 1,
        color: colors.body,
        lineHeight: bodyFontSize + 3,
        maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
        x: PAGE_MARGIN
      });
    }

    if (block.metadata_line) {
      drawWrappedText({
        text: block.metadata_line,
        font: fonts.regular,
        size: Math.max(9, bodyFontSize - 2),
        color: colors.muted,
        lineHeight: bodyFontSize + 2,
        maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
        x: PAGE_MARGIN
      });
    }

    if (block.bullets.length > 0) {
      for (const bullet of block.bullets) {
        drawWrappedText({
          text: `• ${bullet}`,
          font: fonts.regular,
          size: bodyFontSize - 1,
          color: colors.body,
          lineHeight: bodyFontSize + 3,
          maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2 - 10,
          x: PAGE_MARGIN + 10
        });
      }
    } else if (block.body) {
      drawWrappedText({
        text: block.body,
        font: fonts.regular,
        size: bodyFontSize - 1,
        color: colors.body,
        lineHeight: bodyFontSize + 3,
        maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
        x: PAGE_MARGIN
      });
    }

    drawContext.cursorY -= blockSpacing;
  }
};

const renderSectionTimeline = (
  section: ExportDocumentSection,
  drawContext: DrawContext,
  ensureSpace: (requiredHeight: number) => void,
  drawWrappedText: (options: DrawWrappedTextOptions) => void,
  fonts: { regular: PDFFont; bold: PDFFont },
  colors: {
    heading: ReturnType<typeof rgb>;
    accent: ReturnType<typeof rgb>;
    body: ReturnType<typeof rgb>;
    muted: ReturnType<typeof rgb>;
  },
  bodyFontSize: number,
  blockSpacing: number
): void => {
  ensureSpace(24);
  drawWrappedText({
    text: section.title,
    font: fonts.bold,
    size: bodyFontSize + 2,
    color: colors.heading,
    lineHeight: bodyFontSize + 6,
    maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
    x: PAGE_MARGIN
  });

  if (section.inline_text) {
    drawWrappedText({
      text: section.inline_text,
      font: fonts.regular,
      size: bodyFontSize,
      color: colors.body,
      lineHeight: bodyFontSize + 4,
      maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
      x: PAGE_MARGIN
    });
    drawContext.cursorY -= blockSpacing;
    return;
  }

  const timelineX = PAGE_MARGIN + 118;
  const metaX = PAGE_MARGIN;
  const contentX = timelineX + 10;
  const contentWidth = PAGE_WIDTH - PAGE_MARGIN - contentX;

  for (const block of section.blocks) {
    ensureSpace(36);

    drawContext.page.drawLine({
      start: { x: timelineX, y: drawContext.cursorY + 6 },
      end: { x: timelineX, y: drawContext.cursorY - 22 },
      color: colors.accent,
      thickness: 1.2,
      opacity: 0.8
    });

    drawContext.page.drawCircle({
      x: timelineX,
      y: drawContext.cursorY + 2,
      size: 2.6,
      color: colors.accent
    });

    if (block.metadata_line) {
      drawWrappedText({
        text: block.metadata_line,
        font: fonts.regular,
        size: Math.max(8, bodyFontSize - 2),
        color: colors.muted,
        lineHeight: bodyFontSize + 2,
        maxWidth: 106,
        x: metaX
      });
    }

    if (block.headline) {
      drawWrappedText({
        text: block.headline,
        font: fonts.bold,
        size: bodyFontSize,
        color: colors.body,
        lineHeight: bodyFontSize + 4,
        maxWidth: contentWidth,
        x: contentX
      });
    }

    if (block.subheadline) {
      drawWrappedText({
        text: block.subheadline,
        font: fonts.regular,
        size: bodyFontSize - 1,
        color: colors.body,
        lineHeight: bodyFontSize + 3,
        maxWidth: contentWidth,
        x: contentX
      });
    }

    if (block.bullets.length > 0) {
      for (const bullet of block.bullets) {
        drawWrappedText({
          text: `• ${bullet}`,
          font: fonts.regular,
          size: bodyFontSize - 1,
          color: colors.body,
          lineHeight: bodyFontSize + 3,
          maxWidth: contentWidth - 8,
          x: contentX + 8
        });
      }
    } else if (block.body) {
      drawWrappedText({
        text: block.body,
        font: fonts.regular,
        size: bodyFontSize - 1,
        color: colors.body,
        lineHeight: bodyFontSize + 3,
        maxWidth: contentWidth,
        x: contentX
      });
    }

    drawContext.cursorY -= blockSpacing;
  }
};

export const generatePdfDocument = async (documentModel: ExportDocumentModel): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const regularFontBytes = tryReadFontBytes("NotoSans-Regular.ttf");
  const boldFontBytes = tryReadFontBytes("NotoSans-Bold.ttf");
  const regularFont = await pdf.embedFont(regularFontBytes, { subset: false });
  const boldFont = await pdf.embedFont(boldFontBytes, { subset: false });

  const drawContext: DrawContext = {
    page: pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]),
    cursorY: PAGE_HEIGHT - PAGE_MARGIN
  };

  const ensureSpace = (requiredHeight: number): void => {
    if (drawContext.cursorY - requiredHeight >= PAGE_MARGIN) {
      return;
    }

    drawContext.page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawContext.cursorY = PAGE_HEIGHT - PAGE_MARGIN;
  };

  const drawWrappedText = (options: DrawWrappedTextOptions): void => {
    const paragraphs = options.text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      return;
    }

    let index = 0;
    for (const paragraph of paragraphs) {
      const wrappedLines = wrapText(paragraph, options.font, options.size, options.maxWidth);

      for (const line of wrappedLines) {
        ensureSpace(options.lineHeight);
        drawContext.page.drawText(line, {
          x: options.x,
          y: drawContext.cursorY,
          size: options.size,
          font: options.font,
          color: options.color
        });
        drawContext.cursorY -= options.lineHeight;
      }

      index += 1;
      if (index < paragraphs.length) {
        drawContext.cursorY -= options.leadingGap ?? 0;
      }
    }
  };

  const headingColor = hexToRgb(documentModel.theme.heading_color_hex);
  const accentColor = hexToRgb(documentModel.theme.accent_color_hex);
  const bodyColor = hexToRgb(documentModel.theme.body_color_hex);
  const mutedColor = hexToRgb(documentModel.theme.muted_color_hex);
  const bodyFontSize = documentModel.theme.body_text_size;

  let headerStartX = PAGE_MARGIN;
  if (documentModel.photo_data_uri) {
    const parsed = parseDataUriImage(documentModel.photo_data_uri);
    if (parsed) {
      let image: PDFImage;
      if (parsed.mimeType === "image/png") {
        image = await pdf.embedPng(parsed.bytes);
      } else {
        image = await pdf.embedJpg(parsed.bytes);
      }

      const size = 56;
      const y = drawContext.cursorY - size + 8;
      drawContext.page.drawImage(image, {
        x: PAGE_MARGIN,
        y,
        width: size,
        height: size
      });
      headerStartX = PAGE_MARGIN + size + 12;
    }
  }

  drawWrappedText({
    text: documentModel.title,
    font: boldFont,
    size: 20,
    color: headingColor,
    lineHeight: 25,
    maxWidth: PAGE_WIDTH - headerStartX - PAGE_MARGIN,
    x: headerStartX
  });

  if (documentModel.subtitle) {
    drawWrappedText({
      text: documentModel.subtitle,
      font: regularFont,
      size: bodyFontSize,
      color: accentColor,
      lineHeight: bodyFontSize + 4,
      maxWidth: PAGE_WIDTH - headerStartX - PAGE_MARGIN,
      x: headerStartX
    });
  }

  if (documentModel.contact_line) {
    drawWrappedText({
      text: documentModel.contact_line,
      font: regularFont,
      size: Math.max(9, bodyFontSize - 1),
      color: mutedColor,
      lineHeight: bodyFontSize + 3,
      maxWidth: PAGE_WIDTH - headerStartX - PAGE_MARGIN,
      x: headerStartX
    });
  }

  if (documentModel.social_links.length > 0) {
    drawWrappedText({
      text: documentModel.social_links.map((item) => item.label).join(" • "),
      font: regularFont,
      size: Math.max(9, bodyFontSize - 1),
      color: mutedColor,
      lineHeight: bodyFontSize + 3,
      maxWidth: PAGE_WIDTH - headerStartX - PAGE_MARGIN,
      x: headerStartX
    });
  }

  drawContext.cursorY -= 6;
  drawDivider(drawContext.page, drawContext.cursorY, mutedColor);
  drawContext.cursorY -= 18;

  const sections = documentModel.sections;

  if (documentModel.theme.mode === "portfolio-two-column") {
    const sideTypes = new Set(["skills", "languages", "references", "certifications", "courses"]);
    const sideSections = sections.filter((section) => sideTypes.has(section.type));
    const mainSections = sections.filter((section) => !sideTypes.has(section.type));

    for (const section of sideSections) {
      renderSectionDefault(
        section,
        drawContext,
        ensureSpace,
        drawWrappedText,
        { regular: regularFont, bold: boldFont },
        { heading: accentColor, body: bodyColor, muted: mutedColor },
        Math.max(10, bodyFontSize - 1),
        Math.max(6, documentModel.theme.block_spacing - 2)
      );
    }

    drawContext.cursorY -= 8;
    drawDivider(drawContext.page, drawContext.cursorY, accentColor);
    drawContext.cursorY -= 12;

    for (const section of mainSections) {
      renderSectionDefault(
        section,
        drawContext,
        ensureSpace,
        drawWrappedText,
        { regular: regularFont, bold: boldFont },
        { heading: headingColor, body: bodyColor, muted: mutedColor },
        bodyFontSize,
        documentModel.theme.block_spacing
      );
      drawContext.cursorY -= documentModel.theme.section_spacing;
    }
  } else if (documentModel.theme.mode === "timeline-split") {
    for (const section of sections) {
      renderSectionTimeline(
        section,
        drawContext,
        ensureSpace,
        drawWrappedText,
        { regular: regularFont, bold: boldFont },
        { heading: headingColor, accent: accentColor, body: bodyColor, muted: mutedColor },
        bodyFontSize,
        documentModel.theme.block_spacing
      );
      drawContext.cursorY -= documentModel.theme.section_spacing;
    }
  } else {
    for (const section of sections) {
      renderSectionDefault(
        section,
        drawContext,
        ensureSpace,
        drawWrappedText,
        { regular: regularFont, bold: boldFont },
        { heading: headingColor, body: bodyColor, muted: mutedColor },
        bodyFontSize,
        documentModel.theme.block_spacing
      );
      drawContext.cursorY -= documentModel.theme.section_spacing;
    }
  }

  const bytes = await pdf.save();
  return bytes;
};

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { ExportDocumentModel } from "./rendering-document.mapper";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const PAGE_MARGIN = 48;

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

const wrapText = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
  const normalized = text.replace(/\s+/g, " ").trim();
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

export const generatePdfDocument = async (documentModel: ExportDocumentModel): Promise<Uint8Array> => {
  const pdf = await PDFDocument.create();
  const regularFont = await pdf.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdf.embedFont(StandardFonts.HelveticaBold);

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

    let paragraphIndex = 0;
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

      paragraphIndex += 1;
      if (paragraphIndex < paragraphs.length) {
        drawContext.cursorY -= options.leadingGap ?? 0;
      }
    }
  };

  const headingColor = rgb(
    documentModel.theme.heading_color_rgb[0] / 255,
    documentModel.theme.heading_color_rgb[1] / 255,
    documentModel.theme.heading_color_rgb[2] / 255
  );
  const accentColor = rgb(
    documentModel.theme.accent_color_rgb[0] / 255,
    documentModel.theme.accent_color_rgb[1] / 255,
    documentModel.theme.accent_color_rgb[2] / 255
  );
  const bodyColor = rgb(0.12, 0.12, 0.12);
  const mutedColor = rgb(0.35, 0.35, 0.35);

  drawWrappedText({
    text: documentModel.title,
    font: boldFont,
    size: 22,
    color: headingColor,
    lineHeight: 28,
    maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
    x: PAGE_MARGIN
  });

  if (documentModel.subtitle) {
    drawWrappedText({
      text: documentModel.subtitle,
      font: regularFont,
      size: 12,
      color: accentColor,
      lineHeight: 16,
      maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
      x: PAGE_MARGIN
    });
  }

  if (documentModel.contact_line) {
    drawWrappedText({
      text: documentModel.contact_line,
      font: regularFont,
      size: 10,
      color: mutedColor,
      lineHeight: 14,
      maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
      x: PAGE_MARGIN
    });
  }

  drawContext.cursorY -= 10;

  for (const section of documentModel.sections) {
    ensureSpace(28);
    drawWrappedText({
      text: section.title,
      font: boldFont,
      size: 13,
      color: headingColor,
      lineHeight: 18,
      maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
      x: PAGE_MARGIN
    });

    for (const block of section.blocks) {
      if (block.headline) {
        drawWrappedText({
          text: block.headline,
          font: boldFont,
          size: 11,
          color: bodyColor,
          lineHeight: 15,
          maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
          x: PAGE_MARGIN
        });
      }

      if (block.subheadline) {
        drawWrappedText({
          text: block.subheadline,
          font: regularFont,
          size: 10,
          color: bodyColor,
          lineHeight: 14,
          maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
          x: PAGE_MARGIN
        });
      }

      if (block.metadata_line) {
        drawWrappedText({
          text: block.metadata_line,
          font: regularFont,
          size: 9,
          color: mutedColor,
          lineHeight: 13,
          maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
          x: PAGE_MARGIN
        });
      }

      if (block.bullets.length > 0) {
        for (const bullet of block.bullets) {
          drawWrappedText({
            text: `• ${bullet}`,
            font: regularFont,
            size: 10,
            color: bodyColor,
            lineHeight: 14,
            maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2 - 8,
            x: PAGE_MARGIN + 8
          });
        }
      } else if (block.body) {
        drawWrappedText({
          text: block.body,
          font: regularFont,
          size: 10,
          color: bodyColor,
          lineHeight: 14,
          maxWidth: PAGE_WIDTH - PAGE_MARGIN * 2,
          x: PAGE_MARGIN
        });
      }

      drawContext.cursorY -= 6;
    }

    drawContext.cursorY -= 4;
  }

  const bytes = await pdf.save();
  return bytes;
};

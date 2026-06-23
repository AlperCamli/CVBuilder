import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  type FileChild,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
  type IParagraphOptions
} from "docx";
import { resolveCvFontDefinition } from "../../../shared/cv-fonts/cv-font-catalog";
import type { ExportDocumentModel } from "./rendering-document.mapper";

const rgbToHex = (value: string): string => value.replace(/^#/, "").toUpperCase();

const paragraph = (text: string, options?: Partial<IParagraphOptions>): Paragraph => {
  return new Paragraph({
    children: [new TextRun(text)],
    ...options
  });
};

const parseDataUriImage = (dataUri: string): { data: Uint8Array; extension: "png" | "jpg" } | null => {
  const match = dataUri.match(/^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    return null;
  }

  return {
    extension: match[1].toLowerCase() === "png" ? "png" : "jpg",
    data: new Uint8Array(Buffer.from(match[2].replace(/\s+/g, ""), "base64"))
  };
};

const getPngDimensions = (data: Uint8Array): { width: number; height: number } | null => {
  if (
    data.length < 24 ||
    data[0] !== 0x89 ||
    data[1] !== 0x50 ||
    data[2] !== 0x4e ||
    data[3] !== 0x47
  ) {
    return null;
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20)
  };
};

const getJpegDimensions = (data: Uint8Array): { width: number; height: number } | null => {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = data[offset + 1];
    const length = (data[offset + 2] << 8) + data[offset + 3];
    if (length < 2) {
      return null;
    }

    const isStartOfFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isStartOfFrame) {
      return {
        height: (data[offset + 5] << 8) + data[offset + 6],
        width: (data[offset + 7] << 8) + data[offset + 8]
      };
    }

    offset += 2 + length;
  }

  return null;
};

const getImageDimensions = (
  data: Uint8Array,
  extension: "png" | "jpg"
): { width: number; height: number } | null =>
  extension === "png" ? getPngDimensions(data) : getJpegDimensions(data);

const getContainedPhotoSize = (
  data: Uint8Array,
  extension: "png" | "jpg",
  maxSize: number
): { width: number; height: number } => {
  const dimensions = getImageDimensions(data, extension);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return { width: maxSize, height: maxSize };
  }

  const scale = maxSize / Math.max(dimensions.width, dimensions.height);
  return {
    width: Math.max(1, Math.round(dimensions.width * scale)),
    height: Math.max(1, Math.round(dimensions.height * scale))
  };
};

const noTableBorder = {
  style: BorderStyle.NONE,
  size: 0,
  color: "FFFFFF"
} as const;

const readFontBytes = (fileName: string): Buffer => {
  const candidates = [
    resolve(process.cwd(), "assets", "fonts", fileName),
    resolve(process.cwd(), "backend", "assets", "fonts", fileName)
  ];

  for (const candidate of candidates) {
    try {
      return readFileSync(candidate);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error(`Font file not found: ${fileName}`);
};

export const generateDocxDocument = async (documentModel: ExportDocumentModel): Promise<Uint8Array> => {
  const headingColor = rgbToHex(documentModel.theme.heading_color_hex);
  const accentColor = rgbToHex(documentModel.theme.accent_color_hex);
  const bodySize = Math.max(20, Math.round(documentModel.theme.body_text_size * 2));
  const headerAlignment =
    documentModel.theme.header_alignment === "center" ? AlignmentType.CENTER : AlignmentType.LEFT;
  const photoAlignment =
    documentModel.photo_position === "center"
      ? AlignmentType.CENTER
      : documentModel.photo_position === "right"
        ? AlignmentType.RIGHT
        : AlignmentType.LEFT;
  const textHeaderAlignment = documentModel.photo_position === "center" ? AlignmentType.CENTER : headerAlignment;
  const isRuledHeading = documentModel.theme.section_heading_style === "ruled";
  const photoSize = documentModel.theme.header_photo_size ?? 72;
  const fontAsset = resolveCvFontDefinition(documentModel.theme.font_asset_key);
  const documentFont = fontAsset.family;
  const boldDocumentFont = `${fontAsset.family} Bold`;
  const regularFontBytes = readFontBytes(fontAsset.regularFile);
  const boldFontBytes = readFontBytes(fontAsset.boldFile);

  const body: FileChild[] = [];
  const parsedPhoto = documentModel.photo_data_uri
    ? parseDataUriImage(documentModel.photo_data_uri)
    : null;
  const containedPhotoSize = parsedPhoto
    ? getContainedPhotoSize(parsedPhoto.data, parsedPhoto.extension, photoSize)
    : null;

  const photoParagraph = (): Paragraph | null => {
    if (!parsedPhoto || !containedPhotoSize) {
      return null;
    }

    return new Paragraph({
      children: [
        new ImageRun({
          data: parsedPhoto.data,
          type: parsedPhoto.extension,
          transformation: {
            width: containedPhotoSize.width,
            height: containedPhotoSize.height
          }
        })
      ],
      alignment: photoAlignment,
      spacing: {
        after: 140
      }
    });
  };

  const headerTextParagraphs = (alignment: (typeof AlignmentType)[keyof typeof AlignmentType]): Paragraph[] => {
    const paragraphs = [
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [
          new TextRun({
            text: documentModel.title,
            color: headingColor,
            font: boldDocumentFont,
            bold: true,
            size: bodySize + 16
          })
        ],
        alignment,
        spacing: {
          after: 120
        }
      })
    ];

    if (documentModel.subtitle) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: documentModel.subtitle,
              color: accentColor,
              italics: true,
              size: bodySize + 2
            })
          ],
          alignment,
          spacing: {
            after: 100
          }
        })
      );
    }

    if (documentModel.contact_line) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: documentModel.contact_line,
              size: bodySize
            })
          ],
          alignment,
          spacing: {
            after: 120
          }
        })
      );
    }

    if (documentModel.social_links.length > 0) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: documentModel.social_links.map((link) => link.label).join(" • "),
              color: "5A5A5A",
              size: Math.max(18, bodySize - 2)
            })
          ],
          alignment,
          spacing: {
            after: 260
          }
        })
      );
    }

    return paragraphs;
  };

  const photo = photoParagraph();
  if (photo && documentModel.photo_position !== "center") {
    const fullWidthTwips = 9360;
    const photoCellWidthTwips = Math.round((photoSize + 24) * 20);
    const textCellWidthTwips = fullWidthTwips - photoCellWidthTwips;
    const photoCell = new TableCell({
      children: [photo],
      verticalAlign: VerticalAlignTable.CENTER,
      width: {
        size: photoCellWidthTwips,
        type: WidthType.DXA
      },
      margins: {
        top: 0,
        bottom: 0,
        left: 0,
        right: 180
      }
    });
    const textCell = new TableCell({
      children: headerTextParagraphs(headerAlignment),
      verticalAlign: VerticalAlignTable.CENTER,
      width: {
        size: textCellWidthTwips,
        type: WidthType.DXA
      },
      margins: {
        top: 0,
        bottom: 0,
        left: 120,
        right: 0
      }
    });
    const cells = documentModel.photo_position === "right"
      ? [textCell, photoCell]
      : [photoCell, textCell];
    body.push(
      new Table({
        rows: [
          new TableRow({
            children: cells
          })
        ],
        width: {
          size: fullWidthTwips,
          type: WidthType.DXA
        },
        columnWidths: documentModel.photo_position === "right"
          ? [textCellWidthTwips, photoCellWidthTwips]
          : [photoCellWidthTwips, textCellWidthTwips],
        layout: TableLayoutType.FIXED,
        borders: {
          top: noTableBorder,
          bottom: noTableBorder,
          left: noTableBorder,
          right: noTableBorder,
          insideHorizontal: noTableBorder,
          insideVertical: noTableBorder
        }
      })
    );
    body.push(
      new Paragraph({
        spacing: {
          after: 120
        }
      })
    );
  } else {
    if (photo) {
      body.push(photo);
    }
    body.push(...headerTextParagraphs(textHeaderAlignment));
  }

  const sideTypes = new Set(["skills", "languages", "references", "certifications", "courses"]);
  const orderedSections =
    documentModel.theme.mode === "portfolio-two-column"
      ? [
          ...documentModel.sections.filter((section) => sideTypes.has(section.type)),
          ...documentModel.sections.filter((section) => !sideTypes.has(section.type))
        ]
      : documentModel.sections;

  for (const section of orderedSections) {
    body.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({
            text: isRuledHeading ? section.title.toUpperCase() : section.title,
            color: headingColor,
            font: boldDocumentFont,
            bold: true,
            size: bodySize + 4
          })
        ],
        border: isRuledHeading
          ? {
              bottom: {
                color: headingColor,
                space: 1,
                style: BorderStyle.SINGLE,
                size: 4
              }
            }
          : undefined,
        spacing: {
          before: 100,
          after: 80
        }
      })
    );

    if (section.inline_text) {
      body.push(
        paragraph(section.inline_text, {
          spacing: {
            after: 100
          }
        })
      );
      continue;
    }

    for (const block of section.blocks) {
      if (documentModel.theme.mode === "timeline-split" && block.metadata_line) {
        body.push(
          new Paragraph({
            children: [
              new TextRun({
                text: block.metadata_line,
                color: accentColor,
                size: Math.max(18, bodySize - 4)
              })
            ],
            spacing: {
              after: 40
            }
          })
        );
      }

      if (block.headline) {
        body.push(
          new Paragraph({
            children: [
              new TextRun({
                text: block.headline,
                font: boldDocumentFont,
                bold: true,
                size: bodySize + 1
              })
            ],
            spacing: {
              after: 40
            }
          })
        );
      }

      if (block.subheadline) {
        body.push(
          paragraph(block.subheadline, {
            spacing: {
              after: 30
            }
          })
        );
      }

      if (documentModel.theme.mode !== "timeline-split" && block.metadata_line) {
        body.push(
          new Paragraph({
            children: [
              new TextRun({
                text: block.metadata_line,
                color: "6C6C6C",
                size: Math.max(18, bodySize - 4)
              })
            ],
            spacing: {
              after: 40
            }
          })
        );
      }

      if (block.body) {
        // TextRun does not render "\n"; multi-line bodies become one paragraph per line.
        const bodyLines = block.body
          .split(/\n+/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        for (const line of bodyLines) {
          body.push(
            paragraph(line, {
              spacing: {
                after: 40
              }
            })
          );
        }
      }

      if (block.bullets.length > 0) {
        for (const bullet of block.bullets) {
          body.push(
            paragraph(bullet, {
              bullet: {
                level: 0
              },
              spacing: {
                after: 20
              }
            })
          );
        }
      }

      body.push(
        new Paragraph({
          text: "",
          spacing: {
            after: 20
          }
        })
      );
    }
  }

  const doc = new Document({
    fonts: [
      {
        name: documentFont,
        data: regularFontBytes
      },
      {
        name: boldDocumentFont,
        data: boldFontBytes
      }
    ],
    sections: [
      {
        properties: {},
        children: body
      }
    ],
    styles: {
      default: {
        document: {
          run: {
            font: documentFont,
            size: bodySize
          },
          paragraph: {
            spacing: {
              line: 260
            },
            alignment: AlignmentType.LEFT
          }
        }
      }
    }
  });

  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
};

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  TextRun,
  type IParagraphOptions
} from "docx";
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

export const generateDocxDocument = async (documentModel: ExportDocumentModel): Promise<Uint8Array> => {
  const headingColor = rgbToHex(documentModel.theme.heading_color_hex);
  const accentColor = rgbToHex(documentModel.theme.accent_color_hex);
  const bodySize = Math.max(20, Math.round(documentModel.theme.body_text_size * 2));
  const headerAlignment =
    documentModel.theme.header_alignment === "center" ? AlignmentType.CENTER : AlignmentType.LEFT;
  const isRuledHeading = documentModel.theme.section_heading_style === "ruled";
  const photoSize = documentModel.theme.header_photo_size ?? 64;
  const documentFont =
    documentModel.theme.font_asset_key === "noto-serif"
      ? "Cambria"
      : documentModel.theme.layout === "minimal-professional"
        ? "Calibri"
        : "Cambria";

  const body: Paragraph[] = [];

  if (documentModel.photo_data_uri) {
    const parsedPhoto = parseDataUriImage(documentModel.photo_data_uri);
    if (parsedPhoto) {
      const containedPhotoSize = getContainedPhotoSize(
        parsedPhoto.data,
        parsedPhoto.extension,
        photoSize
      );
      body.push(
        new Paragraph({
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
          alignment: headerAlignment,
          spacing: {
            after: 140
          }
        })
      );
    }
  }

  body.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [
        new TextRun({
          text: documentModel.title,
          color: headingColor,
          bold: true,
          size: bodySize + 16
        })
      ],
      alignment: headerAlignment,
      spacing: {
        after: 120
      }
    })
  );

  if (documentModel.subtitle) {
    body.push(
      new Paragraph({
        children: [
          new TextRun({
            text: documentModel.subtitle,
            color: accentColor,
            italics: true,
            size: bodySize + 2
          })
        ],
        alignment: headerAlignment,
        spacing: {
          after: 100
        }
      })
    );
  }

  if (documentModel.contact_line) {
    body.push(
      new Paragraph({
        children: [
          new TextRun({
            text: documentModel.contact_line,
            size: bodySize
          })
        ],
        alignment: headerAlignment,
        spacing: {
          after: 120
        }
      })
    );
  }

  if (documentModel.social_links.length > 0) {
    body.push(
      new Paragraph({
        children: [
          new TextRun({
            text: documentModel.social_links.map((link) => link.label).join(" • "),
            color: "5A5A5A",
            size: Math.max(18, bodySize - 2)
          })
        ],
        alignment: headerAlignment,
        spacing: {
          after: 260
        }
      })
    );
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

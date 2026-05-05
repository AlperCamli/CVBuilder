import {
  AlignmentType,
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

export const generateDocxDocument = async (documentModel: ExportDocumentModel): Promise<Uint8Array> => {
  const headingColor = rgbToHex(documentModel.theme.heading_color_hex);
  const accentColor = rgbToHex(documentModel.theme.accent_color_hex);
  const bodySize = Math.max(20, Math.round(documentModel.theme.body_text_size * 2));

  const body: Paragraph[] = [];

  if (documentModel.photo_data_uri) {
    const parsedPhoto = parseDataUriImage(documentModel.photo_data_uri);
    if (parsedPhoto) {
      body.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: parsedPhoto.data,
              type: parsedPhoto.extension,
              transformation: {
                width: 64,
                height: 64
              }
            })
          ],
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
            text: section.title,
            color: headingColor,
            bold: true,
            size: bodySize + 4
          })
        ],
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
      } else if (block.body) {
        body.push(
          paragraph(block.body, {
            spacing: {
              after: 40
            }
          })
        );
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
            font: documentModel.theme.layout === "minimal-professional" ? "Calibri" : "Cambria",
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

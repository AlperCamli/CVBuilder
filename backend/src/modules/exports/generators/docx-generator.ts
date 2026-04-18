import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
  type IParagraphOptions
} from "docx";
import type { ExportDocumentModel } from "./rendering-document.mapper";

const rgbToHex = (rgb: [number, number, number]): string => {
  return rgb.map((value) => value.toString(16).padStart(2, "0")).join("");
};

const paragraph = (text: string, options?: Partial<IParagraphOptions>): Paragraph => {
  return new Paragraph({
    children: [new TextRun(text)],
    ...options
  });
};

export const generateDocxDocument = async (documentModel: ExportDocumentModel): Promise<Uint8Array> => {
  const headingColor = rgbToHex(documentModel.theme.heading_color_rgb);
  const accentColor = rgbToHex(documentModel.theme.accent_color_rgb);

  const body: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [
        new TextRun({
          text: documentModel.title,
          color: headingColor,
          bold: true,
          size: 38
        })
      ],
      spacing: {
        after: 160
      }
    })
  ];

  if (documentModel.subtitle) {
    body.push(
      new Paragraph({
        children: [
          new TextRun({
            text: documentModel.subtitle,
            color: accentColor,
            italics: true,
            size: 24
          })
        ],
        spacing: {
          after: 140
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
            size: 20
          })
        ],
        spacing: {
          after: 260
        }
      })
    );
  }

  for (const section of documentModel.sections) {
    body.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({
            text: section.title,
            color: headingColor,
            bold: true,
            size: 26
          })
        ],
        spacing: {
          before: 140,
          after: 120
        }
      })
    );

    for (const block of section.blocks) {
      if (block.headline) {
        body.push(
          new Paragraph({
            children: [
              new TextRun({
                text: block.headline,
                bold: true,
                size: 22
              })
            ],
            spacing: {
              after: 60
            }
          })
        );
      }

      if (block.subheadline) {
        body.push(
          paragraph(block.subheadline, {
            spacing: {
              after: 40
            }
          })
        );
      }

      if (block.metadata_line) {
        body.push(
          new Paragraph({
            children: [
              new TextRun({
                text: block.metadata_line,
                color: "6c6c6c",
                size: 18
              })
            ],
            spacing: {
              after: 70
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
                after: 40
              }
            })
          );
        }
      } else if (block.body) {
        body.push(
          paragraph(block.body, {
            spacing: {
              after: 70
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
            font: "Calibri",
            size: 22
          },
          paragraph: {
            spacing: {
              line: 276
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

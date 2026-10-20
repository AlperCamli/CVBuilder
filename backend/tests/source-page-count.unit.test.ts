import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { readSourcePageCount } from "../src/modules/imports/parsers/source-page-count";

const input = (bytes: Uint8Array, originalFilename: string, mimeType: string) => ({ bytes, originalFilename, mimeType, sizeBytes: bytes.length });

describe("source document page count", () => {
  it("counts actual PDF pages, including blank and compressed pages", async () => {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < 3; i++) pdf.addPage();
    expect(await readSourcePageCount(input(await pdf.save(), "cv.pdf", "application/pdf"))).toBe(3);
  });

  it.each(["<Pages>2</Pages>", "<ep:Pages>4</ep:Pages>"])("reads Word's saved count: %s", async (property) => {
    const zip = new JSZip();
    zip.file("docProps/app.xml", `<Properties>${property}</Properties>`);
    const count = property.includes(">2<") ? 2 : 4;
    expect(await readSourcePageCount(input(await zip.generateAsync({ type: "uint8array" }), "cv.docx", "application/octet-stream"))).toBe(count);
  });

  it("does not invent a count when DOCX pagination is missing or invalid", async () => {
    for (const property of ["", "<Pages>0</Pages>", "<Pages>unknown</Pages>"]) {
      const zip = new JSZip();
      zip.file("docProps/app.xml", `<Properties>${property}</Properties>`);
      expect(await readSourcePageCount(input(await zip.generateAsync({ type: "uint8array" }), "cv.docx", "application/octet-stream"))).toBeNull();
    }
  });

  it("leaves damaged or unsupported files available to other import fallbacks", async () => {
    const bytes = new TextEncoder().encode("Unreadable document");
    expect(await readSourcePageCount(input(bytes, "cv.pdf", "application/pdf"))).toBeNull();
    expect(await readSourcePageCount(input(bytes, "cv.txt", "text/plain"))).toBeNull();
  });
});

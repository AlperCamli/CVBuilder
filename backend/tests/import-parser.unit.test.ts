import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { SimpleCvParser, __private } from "../src/modules/imports/parsers/simple-cv-parser";

const toBytes = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, "utf-8"));

const createDocxFixtureBytes = async (documentText: string): Promise<Uint8Array> => {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  const paragraphs = documentText
    .split("\n")
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${line.replace(/&/g, "&amp;")}</w:t></w:r></w:p>`)
    .join("");

  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphs}</w:body>
</w:document>`
  );

  const buffer = await zip.generateAsync({ type: "uint8array" });
  return new Uint8Array(buffer);
};

describe("simple-cv-parser (strong PDF path)", () => {
  it("removes common PDF artifacts while preserving meaningful text", () => {
    const noisy = [
      "%PDF-1.7",
      "1 0 obj",
      "<< /Type /Font >>",
      "endobj",
      "Adobe Identity-H",
      "John Doe",
      "john@example.com",
      "+90 555 000 11 22",
      "Istanbul, Turkey",
      "stream",
      "endstream"
    ].join("\n");

    const cleaned = __private.cleanupExtractedText(noisy);

    expect(cleaned).toContain("John Doe");
    expect(cleaned).toContain("john@example.com");
    expect(cleaned).not.toContain("endobj");
    expect(cleaned).not.toContain("stream");
    expect(cleaned).not.toContain("Adobe Identity-H");
  });

  it("flags low-confidence gibberish text", () => {
    const quality = __private.evaluateTextQuality(
      "@@@@ #### $$$$ %%%% &&&& |||| -- -- -- -- xx xx xx xx xx xx xx xx"
    );

    expect(quality.lowConfidence).toBe(true);
    expect(quality.confidence).toBe("low");
  });

  it("detects all major section headings for English content", async () => {
    const parser = new SimpleCvParser();

    const english = [
      "Header",
      "John Doe",
      "john@doe.dev",
      "Summary",
      "Backend engineer focused on APIs.",
      "Experience",
      "Acme Corp - Senior Engineer",
      "Education",
      "BSc Computer Engineering",
      "Skills",
      "TypeScript, Node.js, PostgreSQL",
      "Languages",
      "English (Fluent), Turkish (Native)",
      "Certifications",
      "AWS Certified Developer",
      "Courses",
      "Distributed Systems",
      "Projects",
      "CV Builder platform",
      "Volunteer",
      "Mentor at local coding group",
      "Awards",
      "Top Performer 2024",
      "Publications",
      "Scaling modular monoliths",
      "References",
      "Available upon request"
    ].join("\n");

    const result = await parser.parse({
      originalFilename: "en.txt",
      mimeType: "text/plain",
      sizeBytes: english.length,
      bytes: toBytes(english)
    });

    const sectionTypes = result.parsedContent.sections.map((section) => section.type);

    expect(sectionTypes).toEqual(
      expect.arrayContaining([
        "header",
        "summary",
        "experience",
        "education",
        "skills",
        "languages",
        "certifications",
        "courses",
        "projects",
        "volunteer",
        "awards",
        "publications",
        "references"
      ])
    );
  });

  it("detects all major section headings for Turkish content", async () => {
    const parser = new SimpleCvParser();

    const turkish = [
      "İletişim Bilgileri",
      "Alper Çamlı",
      "alper@example.com",
      "Özet",
      "Backend geliştirme ve ürün odaklı teslimat.",
      "İş Deneyimi",
      "Şirket A - Kıdemli Yazılım Mühendisi",
      "Eğitim",
      "Bilgisayar Mühendisliği Lisans",
      "Yetenekler",
      "TypeScript, Node.js, PostgreSQL",
      "Diller",
      "Türkçe (Ana Dil), İngilizce (İleri)",
      "Sertifikalar",
      "AWS Certified Developer",
      "Kurslar",
      "Dağıtık Sistemler",
      "Projeler",
      "CV Builder",
      "Gönüllülük",
      "Mentorluk",
      "Ödüller",
      "Yılın Çalışanı",
      "Yayınlar",
      "Teknik makale",
      "Referanslar",
      "Talep üzerine paylaşılabilir"
    ].join("\n");

    const result = await parser.parse({
      originalFilename: "tr.txt",
      mimeType: "text/plain",
      sizeBytes: turkish.length,
      bytes: toBytes(turkish)
    });

    const sectionTypes = result.parsedContent.sections.map((section) => section.type);

    expect(sectionTypes).toEqual(
      expect.arrayContaining([
        "header",
        "summary",
        "experience",
        "education",
        "skills",
        "languages",
        "certifications",
        "courses",
        "projects",
        "volunteer",
        "awards",
        "publications",
        "references"
      ])
    );
  });

  it("parses noisy FlowCV-like PDF text into multiple sections instead of one noisy summary", async () => {
    const parser = new SimpleCvParser();

    const flowCvLikeNoise = [
      "%PDF-1.7",
      "1 0 obj",
      "<< /Type /Font /BaseFont /ABCDEE+Helvetica >>",
      "endobj",
      "Adobe Identity-H",
      "John Doe",
      "john@doe.dev",
      "+90 555 222 11 33",
      "Istanbul, Turkey",
      "SUMMARY",
      "Backend engineer with product focus.",
      "EXPERIENCE",
      "Acme Corp - Senior Engineer 2021 - Present",
      "EDUCATION",
      "BSc Computer Engineering",
      "SKILLS",
      "TypeScript | Node.js | PostgreSQL",
      "https://www.linkedin.com/in/johndoe",
      "https://www.linkedin.com/in/johndoe",
      "endstream",
      "xref",
      "%%EOF"
    ].join("\n");

    const result = await parser.parse({
      originalFilename: "flowcv.pdf",
      mimeType: "application/pdf",
      sizeBytes: flowCvLikeNoise.length,
      bytes: toBytes(flowCvLikeNoise)
    });

    const sectionTypes = result.parsedContent.sections.map((section) => section.type);

    expect(result.parserName).toBe("smart_pdf_parser_v2");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.rawExtractedText).not.toMatch(/endobj|xref|Adobe Identity-H/i);
    expect(sectionTypes.length).toBeGreaterThan(2);
    expect(sectionTypes).toEqual(expect.arrayContaining(["header", "summary", "experience", "education", "skills"]));
  });

  it("handles clean text-bearing PDF token content with fallback extraction and without low-confidence warning", async () => {
    const parser = new SimpleCvParser();

    const cleanTokenPdf = [
      "%PDF-1.4",
      "1 0 obj",
      "<< /Length 240 >>",
      "stream",
      "BT",
      "(Header) Tj",
      "(Jane Doe) Tj",
      "(jane@doe.dev) Tj",
      "(Summary) Tj",
      "(Senior backend engineer with 8 years of experience.) Tj",
      "(Experience) Tj",
      "(Acme Corp - Senior Engineer 2019 - Present) Tj",
      "(Skills) Tj",
      "(TypeScript, Node.js, PostgreSQL, Redis) Tj",
      "ET",
      "endstream",
      "endobj",
      "%%EOF"
    ].join("\n");

    const result = await parser.parse({
      originalFilename: "clean.pdf",
      mimeType: "application/pdf",
      sizeBytes: cleanTokenPdf.length,
      bytes: toBytes(cleanTokenPdf)
    });

    expect(result.parserName).toBe("smart_pdf_parser_v2");
    expect(result.diagnostics?.final_stage).toBeDefined();
    expect(result.warnings.join("\n")).not.toMatch(/Low-confidence extraction detected/i);
    expect(result.parsedContent.sections.map((section) => section.type)).toEqual(
      expect.arrayContaining(["header", "summary", "experience", "skills"])
    );
  });

  it("keeps non-PDF inputs on stable parser contract and behavior", async () => {
    const parser = new SimpleCvParser();

    const markdown = [
      "# Summary",
      "API-first backend engineer.",
      "## Skills",
      "TypeScript, Node.js, Postgres"
    ].join("\n");

    const result = await parser.parse({
      originalFilename: "cv.md",
      mimeType: "text/markdown",
      sizeBytes: markdown.length,
      bytes: toBytes(markdown)
    });

    expect(result.parserName).toBe("simple_cv_parser_v1");
    expect(result.parsedContent.sections.map((section) => section.type)).toEqual(
      expect.arrayContaining(["summary", "skills"])
    );
  });

  it("parses DOCX files with XML extraction and section detection", async () => {
    const parser = new SimpleCvParser();
    const docxText = [
      "Header",
      "Edanur Gokten",
      "edanur@example.com",
      "Summary",
      "Backend engineer with strong API design focus.",
      "Experience",
      "Company A - Backend Engineer 2023 - Present",
      "Education",
      "Computer Engineering",
      "Skills",
      "TypeScript, Node.js, PostgreSQL"
    ].join("\n");
    const bytes = await createDocxFixtureBytes(docxText);

    const result = await parser.parse({
      originalFilename: "edanur_gokten_cv.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: bytes.length,
      bytes
    });

    expect(result.parserName).toBe("smart_docx_parser_v1");
    expect(result.diagnostics?.final_stage).toBe("docx_xml_text");
    expect(result.rawExtractedText).toContain("Edanur Gokten");
    expect(result.parsedContent.sections.map((section) => section.type)).toEqual(
      expect.arrayContaining(["header", "summary", "experience", "education", "skills"])
    );
  });

  it("auto-detects DOCX parsing from extension when MIME type is generic", async () => {
    const parser = new SimpleCvParser();
    const bytes = await createDocxFixtureBytes(["Summary", "Imported from single button flow"].join("\n"));

    const result = await parser.parse({
      originalFilename: "candidate.docx",
      mimeType: "application/octet-stream",
      sizeBytes: bytes.length,
      bytes
    });

    expect(result.parserName).toBe("smart_docx_parser_v1");
    expect(result.warnings.join("\n")).toMatch(/auto-resolved as 'docx'/i);
  });

  it("auto-detects PDF parsing from signature when MIME type is generic", async () => {
    const parser = new SimpleCvParser();
    const pseudoPdf = "%PDF-1.7\nSummary\nSignature based pdf detection";

    const result = await parser.parse({
      originalFilename: "uploaded.bin",
      mimeType: "application/octet-stream",
      sizeBytes: pseudoPdf.length,
      bytes: toBytes(pseudoPdf)
    });

    expect(result.parserName).toBe("smart_pdf_parser_v2");
    expect(result.warnings.join("\n")).toMatch(/auto-resolved as 'pdf'/i);
  });
});

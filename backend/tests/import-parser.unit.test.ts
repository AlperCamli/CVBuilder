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

  it("keeps parsed content language pinned to English", async () => {
    const parser = new SimpleCvParser();
    const mixedContent = ["Summary", "Experienced engineer.", "Languages", "English (Fluent)"].join("\n");

    const result = await parser.parse({
      originalFilename: "language-lock.txt",
      mimeType: "text/plain",
      sizeBytes: mixedContent.length,
      bytes: toBytes(mixedContent)
    });

    expect(result.parsedContent.language).toBe("en");
  });

  it("parses Alper CV-style extracted PDF text without false publications and with correct header email", () => {
    const extractedText = [
      "Alper Çamlı",
      "camlialper03 @gmail.com +90 542 592 3911 Istanbul, Turkey github/AlperCamli",
      "in/alpercamli",
      "Education",
      "Computer Science , Sabancı University 02/2022 – 01/2026",
      "• Board Member, Game Developers Club",
      "Work Experience",
      "Business Intelligence Intern , Vakıfbank 07/2025 – 09/2025",
      "• Designed and implemented an end-to-end Business Intelligence pipeline, including İstanbul",
      "data modelling, data generation, ETL, DataMart creation and Data Visualization, using",
      "PostgreSQL, Clickhouse and Spark.",
      "• Developed a synthetic banking transaction dataset reflecting realistic customer",
      "behaviors.",
      "• Applied ETL operations on Informatica Power Center and Spark for daily analytical",
      "data, Created DataMarts for analytical reporting.",
      "SAP Consulting Intern , Prodea Consulting 11/2025 – 12/2025",
      "• Assisted SAP consultants with business requirement analysis and SAP system support. Istanbul",
      "• Gained hands-on experience with SAP GUI, ABAP basics, and ERP business processes.",
      "E-commerce Intern , Adil Işık Group 08/2024 – 09/2024",
      "• Contributed to the management of the online store, digital marketing campaigns, and Istanbul, Turkey",
      "data analysis to improve user experience and drive sales. Collaborated with cross-",
      "functional teams to streamline e-commerce operations and support business growth.",
      "Undergraduate Research Assistant , Sabancı University 10/2023 – 01/2024",
      "Advisor: Berna Beyhan",
      "• Involved in the project \"Understanding Team Building Skills in Entrepreneurship: The",
      "Case of Turkish Gaming Startups\" within the scope of the Program for Undergraduate",
      "Research (PURE) at Sabancı University.",
      "• Interviewed with 10 Turkish Gaming Start-ups to report challenges and insights from",
      "the industry.",
      "Awards",
      "National 2nd Prize in Physics - TUBITAK 2204-C Polar Research Projects Competition 11/2021",
      "for High School Students , Tubitak (The Scientific and Research Council of Turkey)",
      "• Earned 2nd place among 90 finalist teams with the project \"Measurement of the Effect",
      "of UV Light on Ozone Concentration in the Atmosphere of Antartica\".",
      "References",
      "Sefa Hakyemez , Data Engineer , Vakıfbank",
      "sefa.hakyemez@vakifbank.com.tr, +90 536 822 38 68",
      "Languages",
      "Turkish English",
      "(Native) (IELTS; 7.5/ C1)"
    ].join("\n");

    const content = __private.toStructuredContent(extractedText);
    const sectionTypes = content.sections.map((section) => section.type);
    const experienceSection = content.sections.find((section) => section.type === "experience");
    const referencesSection = content.sections.find((section) => section.type === "references");

    expect(content.language).toBe("en");
    expect(content.metadata.email).toBe("camlialper03@gmail.com");
    expect(sectionTypes).toEqual(
      expect.arrayContaining(["header", "education", "experience", "awards", "references", "languages"])
    );
    expect(sectionTypes).not.toContain("publications");
    expect(experienceSection?.blocks.length).toBeGreaterThan(1);
    expect(
      experienceSection?.blocks.some((block) =>
        String(block.fields.role ?? "").toLowerCase().includes("business intelligence intern")
      )
    ).toBe(true);
    expect(referencesSection?.blocks[0]?.fields.email).toBe("sefa.hakyemez@vakifbank.com.tr");
  });

  it("splits role/company with comma while preserving hyphenated description text", () => {
    const content = __private.toStructuredContent(
      [
        "Work Experience",
        "Business Intelligence Intern, Vakıfbank 07/2025 - 09/2025",
        "Designed and implemented an end-to-end analytics pipeline for e-commerce operations."
      ].join("\n")
    );

    const experienceSection = content.sections.find((section) => section.type === "experience");
    const firstBlock = experienceSection?.blocks[0];

    expect(firstBlock?.fields.role).toBe("Business Intelligence Intern");
    expect(firstBlock?.fields.company).toBe("Vakıfbank");
    expect(String(firstBlock?.fields.description ?? "")).toContain("end-to-end analytics pipeline");
    expect(String(firstBlock?.fields.description ?? "")).toContain("e-commerce operations");
  });

  it("attaches ambiguous and bullet continuation lines to the active experience entry", () => {
    const content = __private.toStructuredContent(
      [
        "Experience",
        "Business Intelligence Intern, Vakıfbank 07/2025 - 09/2025",
        "Designed and implemented an end-to-end Business Intelligence pipeline",
        "• Built ETL jobs and datamarts",
        "SAP Consulting Intern, Prodea Consulting 11/2025 - 12/2025",
        "• Assisted consultants with requirement analysis"
      ].join("\n")
    );

    const experienceSection = content.sections.find((section) => section.type === "experience");
    expect(experienceSection?.blocks.length).toBe(2);
    expect(experienceSection?.blocks.some((block) => block.type === "experience_items")).toBe(false);

    const firstBlockDescription = String(experienceSection?.blocks[0]?.fields.description ?? "");
    expect(firstBlockDescription).toContain("Designed and implemented");
    expect(firstBlockDescription).toContain("Built ETL jobs");
  });

  it("detects volunteer aliases such as Volunteer Work and Extracurricular Activities", () => {
    const volunteerContent = __private.toStructuredContent(
      [
        "Volunteer Work",
        "Mentor, Code Club 01/2024 - Present",
        "Guided junior developers."
      ].join("\n")
    );
    const extracurricularContent = __private.toStructuredContent(
      [
        "Extracurricular Activities",
        "Board Member, Game Developers Club 09/2023 - 06/2024",
        "Organized events."
      ].join("\n")
    );

    expect(volunteerContent.sections.map((section) => section.type)).toContain("volunteer");
    expect(extracurricularContent.sections.map((section) => section.type)).toContain("volunteer");
  });

  it("keeps Alper CV experience entries as real jobs without synthetic *_items blocks", () => {
    const extractedText = [
      "Work Experience",
      "Business Intelligence Intern , Vakıfbank 07/2025 – 09/2025",
      "• Designed and implemented an end-to-end Business Intelligence pipeline.",
      "SAP Consulting Intern , Prodea Consulting 11/2025 – 12/2025",
      "• Assisted SAP consultants with business requirement analysis.",
      "E-commerce Intern , Adil Işık Group 08/2024 – 09/2024",
      "• Contributed to online store and digital marketing operations.",
      "Undergraduate Research Assistant , Sabancı University 10/2023 – 01/2024",
      "• Interviewed Turkish gaming startups and reported insights."
    ].join("\n");

    const content = __private.toStructuredContent(extractedText);
    const experienceSection = content.sections.find((section) => section.type === "experience");
    const experienceBlocks = experienceSection?.blocks ?? [];

    expect(experienceBlocks.length).toBe(4);
    expect(experienceBlocks.some((block) => block.type === "experience_items")).toBe(false);
    expect(experienceBlocks.every((block) => String(block.fields.company ?? "").trim().length > 0)).toBe(true);
    expect(experienceBlocks.every((block) => String(block.fields.role ?? "").trim().length > 0)).toBe(true);
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

  it("adds section-specific structured fields for text-based entries", async () => {
    const parser = new SimpleCvParser();
    const content = [
      "Experience",
      "Backend Engineer - Acme Corp Jan 2022 - Present Built internal services.",
      "Education",
      "B.Sc. Computer Engineering, Istanbul Technical University (Expected Jan 2026) GPA: 3.32/4.00",
      "Certifications",
      "AWS Certified Developer https://example.com/cert/123 verification id: ABC-123",
      "Publications",
      "Reliable APIs - Journal of Systems 2024"
    ].join("\n");

    const result = await parser.parse({
      originalFilename: "structured.txt",
      mimeType: "text/plain",
      sizeBytes: content.length,
      bytes: toBytes(content)
    });

    const sections = result.parsedContent.sections;
    const experienceBlock = sections
      .find((section) => section.type === "experience")
      ?.blocks.find((block) => block.type.includes("experience"));
    const educationBlock = sections
      .find((section) => section.type === "education")
      ?.blocks.find((block) => block.type.includes("education"));
    const certificationBlock = sections
      .find((section) => section.type === "certifications")
      ?.blocks[0];
    const publicationBlock = sections
      .find((section) => section.type === "publications")
      ?.blocks[0];

    expect(experienceBlock?.fields.role).toBeDefined();
    expect(experienceBlock?.fields.start_date).toBeDefined();
    expect(experienceBlock?.fields.current_role).toBeDefined();
    expect(educationBlock?.fields.gpa).toBeDefined();
    expect(educationBlock?.fields.expected_graduation).toBeDefined();
    expect(certificationBlock?.fields.name).toBeDefined();
    expect(certificationBlock?.fields.verification_id).toBeDefined();
    expect(publicationBlock?.fields.publisher).toBeDefined();
  });

  it("keeps OCR fallback disabled by default in test runtime", async () => {
    const parser = new SimpleCvParser();
    const noisyPdf = [
      "%PDF-1.7",
      "1 0 obj",
      "stream",
      "@@@@ #### $$$$ %%%%",
      "ABCD ABCD ABCD ABCD",
      "endstream",
      "endobj",
      "%%EOF"
    ].join("\n");

    const result = await parser.parse({
      originalFilename: "ocr-disabled.pdf",
      mimeType: "application/pdf",
      sizeBytes: noisyPdf.length,
      bytes: toBytes(noisyPdf)
    });

    expect(result.diagnostics?.attempted_stages).not.toContain("pdf_ocr_tesseract");
    expect(result.warnings.join("\n")).toMatch(/PDF OCR fallback is disabled/i);
  });
});

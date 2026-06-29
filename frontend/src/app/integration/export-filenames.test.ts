import { describe, expect, it } from "vitest";
import {
  buildCoverLetterExportFilename,
  buildCvExportFilename,
  buildTailoredExportFilename
} from "./export-filenames";

describe("export filename helpers", () => {
  it("decodes percent-encoded Turkish characters in CV filenames", () => {
    expect(buildCvExportFilename("%C3%87a%C4%9Fr%C4%B1%20%C3%9Cnal", "pdf")).toBe(
      "Çağrı Ünal.pdf"
    );
  });

  it("keeps decoded names and surnames in tailored CV filenames", () => {
    expect(
      buildTailoredExportFilename(
        "%C3%87a%C4%9Fr%C4%B1%20%C3%9Cnal",
        "Tailored CV",
        "%C4%B0leti%C5%9Fim%20A.%C5%9E."
      )
    ).toBe("001-Çağrı-Ünal-İletişim-A.Ş.pdf");
  });

  it("falls back to the role for cover letters without a company", () => {
    expect(
      buildCoverLetterExportFilename("Cover Letter - ", { job_title: "Frontend Engineer", company_name: "" }, "docx")
    ).toBe("Cover Letter - Frontend Engineer.docx");
  });
});

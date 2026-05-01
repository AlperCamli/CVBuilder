import { describe, expect, it } from "vitest";
import type { CvContent } from "../src/shared/cv-content/cv-content.types";
import { canonicalizeImportedCvContent } from "../src/modules/imports/import-content-canonicalizer";

const baseContent = (): CvContent => ({
  version: "v1",
  language: "en",
  metadata: {},
  sections: []
});

describe("import content canonicalizer", () => {
  it("maps personal/contact section aliases to header and promotes canonical metadata keys", () => {
    const content: CvContent = {
      ...baseContent(),
      metadata: {
        name: "Alper Çamlı",
        title: "Computer Science Student",
        github: "github/AlperCamli",
        linkedin: "in/alpercamli"
      },
      sections: [
        {
          id: "personal-1",
          type: "personal_info",
          title: "Personal Information",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "personal-block-1",
              type: "personal_info",
              order: 0,
              visibility: "visible",
              fields: {
                email: "camlialper03@gmail.com",
                phone: "+90 542 592 3911",
                location: "Istanbul, Turkey",
                urls: ["github/AlperCamli", "in/alpercamli"]
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const canonicalized = canonicalizeImportedCvContent(content);

    expect(canonicalized.sections[0]?.type).toBe("header");
    expect(canonicalized.metadata.full_name).toBe("Alper Çamlı");
    expect(canonicalized.metadata.headline).toBe("Computer Science Student");
    expect(canonicalized.metadata.email).toBe("camlialper03@gmail.com");
    expect(canonicalized.metadata.phone).toBe("+90 542 592 3911");
    expect(canonicalized.metadata.location).toBe("Istanbul, Turkey");
    expect(canonicalized.metadata.urls).toEqual(
      expect.arrayContaining([
        "https://github.com/AlperCamli",
        "https://www.linkedin.com/in/alpercamli"
      ])
    );
  });

  it("maps awards issuing organization aliases to issuer", () => {
    const content: CvContent = {
      ...baseContent(),
      sections: [
        {
          id: "awards-1",
          type: "awards",
          title: "Awards",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "award-block-1",
              type: "award_item",
              order: 0,
              visibility: "visible",
              fields: {
                name: "National 2nd Prize in Physics",
                issuing_organization: "TUBITAK"
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const canonicalized = canonicalizeImportedCvContent(content);
    const awardFields = canonicalized.sections[0]?.blocks[0]?.fields ?? {};

    expect(awardFields.issuer).toBe("TUBITAK");
  });

  it("stores non-proficiency language bracket details in certificate field", () => {
    const content: CvContent = {
      ...baseContent(),
      sections: [
        {
          id: "languages-1",
          type: "languages",
          title: "Languages",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "language-block-1",
              type: "languages",
              order: 0,
              visibility: "visible",
              fields: {
                text: "Turkish (Native), English (IELTS 7.5 / C1)"
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const canonicalized = canonicalizeImportedCvContent(content);
    const blocks = canonicalized.sections[0]?.blocks ?? [];

    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.fields.language).toBe("Turkish");
    expect(blocks[0]?.fields.proficiency).toBe("Native");
    expect(blocks[0]?.fields.certificate).toBe("");

    expect(blocks[1]?.fields.language).toBe("English");
    expect(blocks[1]?.fields.proficiency).toBe("");
    expect(blocks[1]?.fields.certificate).toBe("IELTS 7.5 / C1");
  });

  it("fills education field_of_study from major alias and degree subject fallback", () => {
    const content: CvContent = {
      ...baseContent(),
      sections: [
        {
          id: "education-1",
          type: "education",
          title: "Education",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "edu-block-1",
              type: "education_item",
              order: 0,
              visibility: "visible",
              fields: {
                institution: "Sabancı University",
                degree: "Computer Science"
              },
              meta: {}
            },
            {
              id: "edu-block-2",
              type: "education_item",
              order: 1,
              visibility: "visible",
              fields: {
                school: "Sabancı University",
                qualification: "Bachelor of Science",
                major: "Computer Science"
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const canonicalized = canonicalizeImportedCvContent(content);
    const blocks = canonicalized.sections[0]?.blocks ?? [];

    expect(blocks[0]?.fields.field_of_study).toBe("Computer Science");
    expect(blocks[1]?.fields.field_of_study).toBe("Computer Science");
    expect(blocks[1]?.fields.degree).toBe("Bachelor of Science");
  });

  it("fills experience role/company from alias fields", () => {
    const content: CvContent = {
      ...baseContent(),
      sections: [
        {
          id: "experience-1",
          type: "experience",
          title: "Experience",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "exp-block-1",
              type: "experience_item",
              order: 0,
              visibility: "visible",
              fields: {
                job_title: "Business Intelligence Intern",
                company_name: "Vakıfbank",
                city: "Istanbul"
              },
              meta: {}
            }
          ]
        }
      ]
    };

    const canonicalized = canonicalizeImportedCvContent(content);
    const fields = canonicalized.sections[0]?.blocks[0]?.fields ?? {};

    expect(fields.role).toBe("Business Intelligence Intern");
    expect(fields.company).toBe("Vakıfbank");
    expect(fields.location).toBe("Istanbul");
  });
});

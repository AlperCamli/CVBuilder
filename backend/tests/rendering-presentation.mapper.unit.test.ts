import { describe, expect, it } from "vitest";
import type { CvJsonValue } from "../src/shared/cv-content/cv-content.types";
import { mapRenderingPayloadToPresentation } from "../src/modules/rendering/rendering-presentation";
import type { RenderingBlock, RenderingPayload } from "../src/modules/rendering/rendering.types";

const field = (raw: CvJsonValue, text: string, textItems: string[] = []): { raw: CvJsonValue; text: string; text_items: string[] } => ({
  raw,
  text,
  text_items: textItems
});

const block = (input: Partial<RenderingBlock> & { id: string; type: string }): RenderingBlock => ({
  id: input.id,
  type: input.type,
  order: input.order ?? 0,
  visibility: input.visibility ?? "visible",
  fields: input.fields ?? {},
  meta: input.meta ?? {},
  normalized_fields: input.normalized_fields ?? {},
  derived: input.derived ?? {
    headline: null,
    subheadline: null,
    bullets: [],
    date_range: null,
    location: null
  },
  plain_text: input.plain_text ?? ""
});

const renderingPayload = (): RenderingPayload => ({
  version: "v1",
  document: {
    kind: "master",
    id: "master-1",
    title: "My CV",
    language: "en",
    generated_at: "2026-04-30T00:00:00.000Z",
    updated_at: null,
    context: {}
  },
  template: {
    resolution: "selected",
    template: {
      id: "template-1",
      name: "Modern Clean",
      slug: "modern-clean",
      status: "active",
      module_type: "standard",
      preview_config: null,
      export_config: null,
      created_at: "2026-04-30T00:00:00.000Z",
      updated_at: "2026-04-30T00:00:00.000Z"
    }
  },
  sections: [
    {
      id: "summary",
      type: "summary",
      title: "Summary",
      order: 0,
      meta: {},
      plain_text: "Highly motivated student",
      blocks: [
        block({
          id: "summary-1",
          type: "summary",
          normalized_fields: {
            text: field("Highly motivated student", "Highly motivated student", ["Highly motivated student"])
          },
          derived: {
            headline: "Highly motivated student",
            subheadline: null,
            bullets: [],
            date_range: null,
            location: null
          },
          plain_text: "Highly motivated student"
        })
      ]
    },
    {
      id: "experience",
      type: "experience",
      title: "Experience",
      order: 1,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "exp-1",
          type: "experience_item",
          normalized_fields: {
            role: field("Business Intelligence Intern", "Business Intelligence Intern", ["Business Intelligence Intern"]),
            company: field("Vakıfbank", "Vakıfbank", ["Vakıfbank"]),
            start_date: field("07/2025", "07/2025", ["07/2025"]),
            end_date: field("09/2025", "09/2025", ["09/2025"]),
            description: field("Engineered ETL flows", "Engineered ETL flows", ["Engineered ETL flows"])
          },
          derived: {
            headline: "Business Intelligence Intern",
            subheadline: "Vakıfbank",
            bullets: [],
            date_range: "07/2025 - 09/2025",
            location: null
          },
          plain_text: "Business Intelligence Intern Vakıfbank Engineered ETL flows"
        })
      ]
    },
    {
      id: "education",
      type: "education",
      title: "Education",
      order: 2,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "edu-1",
          type: "education_item",
          normalized_fields: {
            degree: field("Bachelor of Science", "Bachelor of Science", ["Bachelor of Science"]),
            institution: field("Sabancı University", "Sabancı University", ["Sabancı University"]),
            start_date: field("02/2022", "02/2022", ["02/2022"]),
            end_date: field("01/2026", "01/2026", ["01/2026"]),
            description: field("Board Member of the Game Developers Club", "Board Member of the Game Developers Club", ["Board Member of the Game Developers Club"])
          },
          derived: {
            headline: "Bachelor of Science",
            subheadline: "Sabancı University",
            bullets: [],
            date_range: "02/2022 - 01/2026",
            location: null
          },
          plain_text: "Bachelor of Science Sabancı University"
        })
      ]
    },
    {
      id: "skills",
      type: "skills",
      title: "Skills",
      order: 3,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "skills-1",
          type: "skills",
          normalized_fields: {
            skills: field(["PostgreSQL", "Spark", "PostgreSQL"], "PostgreSQL Spark PostgreSQL", ["PostgreSQL", "Spark", "PostgreSQL"])
          }
        }),
        block({
          id: "skills-2",
          type: "skills",
          normalized_fields: {
            items: field(["Spark", "Informatica"], "Spark Informatica", ["Spark", "Informatica"])
          }
        })
      ]
    },
    {
      id: "languages",
      type: "languages",
      title: "Languages",
      order: 4,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "lang-1",
          type: "language_item",
          normalized_fields: {
            language: field("Turkish", "Turkish", ["Turkish"]),
            proficiency: field("Native", "Native", ["Native"])
          }
        }),
        block({
          id: "lang-2",
          type: "language_item",
          normalized_fields: {
            text: field("English (Professional), Turkish (Native)", "English (Professional), Turkish (Native)", ["English (Professional), Turkish (Native)"])
          }
        })
      ]
    }
  ],
  plain_text: ""
});

describe("rendering presentation mapper", () => {
  it("maps section titles, deduplicates inline lists, and preserves social/photo metadata", () => {
    const metadata: Record<string, CvJsonValue> = {
      full_name: "Alper Çamlı",
      headline: "Computer Science Student",
      email: "alper@example.com",
      phone: "+90 500 000 00 00",
      location: "Istanbul, Turkey",
      photo: "data:image/png;base64,AAA",
      social_links: [
        {
          id: "link-1",
          type: "github",
          url: "https://github.com/AlperCamli"
        }
      ],
      urls: ["linkedin.com/in/alpercamli"]
    };

    const presentation = mapRenderingPayloadToPresentation(renderingPayload(), metadata, {
      id: "template-1",
      name: "Modern Clean",
      slug: "modern-clean",
      status: "active",
      module_type: "standard",
      preview_config: null,
      export_config: null,
      created_at: "2026-04-30T00:00:00.000Z",
      updated_at: "2026-04-30T00:00:00.000Z"
    });

    expect(presentation.header.name).toBe("Alper Çamlı");
    expect(presentation.document_title).toBe("My CV");
    expect(presentation.header.photo).toBe("data:image/png;base64,AAA");
    expect(presentation.header.social_links).toHaveLength(2);

    expect(presentation.sections[0]?.title).toBe("Professional Summary");
    expect(presentation.sections[1]?.title).toBe("Work Experience");

    const experienceSection = presentation.sections.find((section) => section.type === "experience");
    const experienceItem = experienceSection?.items[0];
    expect(experienceItem?.title?.startsWith("Business Intelligence Intern, ")).toBe(true);
    expect(experienceItem?.subtitle).toBeNull();

    const skillsSection = presentation.sections.find((section) => section.type === "skills");
    expect(skillsSection?.inline_text).toBe("PostgreSQL, Spark, Informatica");

    const languagesSection = presentation.sections.find((section) => section.type === "languages");
    expect(languagesSection?.inline_text).toContain("Turkish (Native)");
    expect(languagesSection?.inline_text).toContain("English (Professional)");

    const educationSection = presentation.sections.find((section) => section.type === "education");
    const educationItem = educationSection?.items[0];
    expect(educationItem?.body).toBe("Board Member of the Game Developers Club");
  });

  it("applies LaTeX-inspired academic profile tokens", () => {
    const expectedProfiles = [
      { slug: "latex-academic-serif", name: "Academic Serif", bodyTextSize: 11 },
      { slug: "latex-research-cv", name: "Research CV", bodyTextSize: 10.8 }
    ];

    for (const profile of expectedProfiles) {
      const payload = renderingPayload();
      payload.template.template = {
        id: `template-${profile.slug}`,
        name: profile.name,
        slug: profile.slug,
        status: "active",
        module_type: "standard",
        preview_config: { badges: ["LaTeX"] },
        export_config: { pdf: { enabled: true }, docx: { enabled: true } },
        created_at: "2026-06-23T00:00:00.000Z",
        updated_at: "2026-06-23T00:00:00.000Z"
      };

      const presentation = mapRenderingPayloadToPresentation(payload, {}, payload.template.template);

      expect(presentation.theme.template_slug).toBe(profile.slug);
      expect(presentation.theme.layout).toBe("academic-classic");
      expect(presentation.theme.tokens.font_asset_key).toBe("noto-serif");
      expect(presentation.theme.tokens.header_alignment).toBe("center");
      expect(presentation.theme.tokens.header_photo_size).toBe(76);
      expect(presentation.theme.tokens.section_heading_style).toBe("ruled");
      expect(presentation.theme.tokens.body_text_size).toBe(profile.bodyTextSize);
      expect(presentation.theme.tokens.font_family).toContain("Noto Serif");
    }
  });

  it("does not use legacy free-text fallback for education body", () => {
    const payload = renderingPayload();
    const educationSection = payload.sections.find((section) => section.type === "education");
    const educationBlock = educationSection?.blocks[0];
    if (!educationBlock) {
      throw new Error("education block fixture missing");
    }

    educationBlock.normalized_fields = {
      degree: field("Computer Science", "Computer Science", ["Computer Science"]),
      institution: field("Sabancı University", "Sabancı University", ["Sabancı University"]),
      start_date: field("02/2022", "02/2022", ["02/2022"]),
      end_date: field("01/2026", "01/2026", ["01/2026"]),
      text: field(
        "Computer Science 01/2026 Board Member, Game Developers Club 02/2022 Sabancı University false false",
        "Computer Science 01/2026 Board Member, Game Developers Club 02/2022 Sabancı University false false",
        [
          "Computer Science 01/2026 Board Member, Game Developers Club 02/2022 Sabancı University false false"
        ]
      )
    };

    const presentation = mapRenderingPayloadToPresentation(payload, {}, null);
    const mappedEducation = presentation.sections.find((section) => section.type === "education");
    const mappedItem = mappedEducation?.items[0];

    expect(mappedItem?.title).toBe("Computer Science");
    expect(mappedItem?.subtitle).toBe("Sabancı University");
    expect(mappedItem?.body).toBeNull();
  });

  it("does not emit header as a section and falls back to header block metadata", () => {
    const payload = renderingPayload();
    payload.sections.unshift({
      id: "header",
      type: "header",
      title: "Header",
      order: -1,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "header-1",
          type: "header",
          normalized_fields: {
            full_name: field("Jane Doe", "Jane Doe", ["Jane Doe"]),
            headline: field("Data Engineer", "Data Engineer", ["Data Engineer"]),
            email: field("jane@example.com", "jane@example.com", ["jane@example.com"]),
            phone: field("+1 202 555 0100", "+1 202 555 0100", ["+1 202 555 0100"]),
            location: field("Istanbul, Turkey", "Istanbul, Turkey", ["Istanbul, Turkey"]),
            urls: field(
              ["https://github.com/janedoe", "linkedin.com/in/janedoe"],
              "https://github.com/janedoe linkedin.com/in/janedoe",
              ["https://github.com/janedoe", "linkedin.com/in/janedoe"]
            )
          }
        })
      ]
    });

    const presentation = mapRenderingPayloadToPresentation(payload, {}, null);

    expect(presentation.header.name).toBe("Jane Doe");
    expect(presentation.header.title).toBe("Data Engineer");
    expect(presentation.header.email).toBe("jane@example.com");
    expect(presentation.header.social_links.length).toBeGreaterThan(0);
    expect(presentation.sections.some((section) => section.type === "header")).toBe(false);
  });

  it("filters header-like generic sections and maps generic section title safely", () => {
    const payload = renderingPayload();
    payload.sections.unshift({
      id: "section-1",
      type: "section_1",
      title: "Section 1",
      order: -1,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "section-1-block-1",
          type: "text",
          normalized_fields: {
            full_name: field("Alper Çamlı", "Alper Çamlı", ["Alper Çamlı"]),
            email: field("alper@example.com", "alper@example.com", ["alper@example.com"]),
            phone: field("+90 500 000 00 00", "+90 500 000 00 00", ["+90 500 000 00 00"]),
            location: field("Istanbul, Turkey", "Istanbul, Turkey", ["Istanbul, Turkey"])
          }
        })
      ]
    });

    payload.sections.push({
      id: "section-custom",
      type: "section_9",
      title: "Section 9",
      order: 99,
      meta: {},
      plain_text: "Some additional info",
      blocks: [
        block({
          id: "section-custom-block-1",
          type: "text",
          normalized_fields: {
            text: field("Some additional info", "Some additional info", ["Some additional info"])
          },
          plain_text: "Some additional info"
        })
      ]
    });

    const presentation = mapRenderingPayloadToPresentation(payload, {}, null);

    expect(presentation.sections.some((section) => section.id === "section-1")).toBe(false);
    const additionalSection = presentation.sections.find((section) => section.id === "section-custom");
    expect(additionalSection?.title).toBe("Additional Information");
  });

  it("maps awards without duplicating date into subtitle", () => {
    const payload = renderingPayload();
    payload.sections.push({
      id: "awards",
      type: "awards",
      title: "Awards",
      order: 5,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "award-1",
          type: "award_item",
          normalized_fields: {
            name: field("Top Performer Award", "Top Performer Award", ["Top Performer Award"]),
            date: field("2024", "2024", ["2024"])
          },
          derived: {
            headline: "Top Performer Award",
            subheadline: null,
            bullets: [],
            date_range: "2024",
            location: null
          }
        })
      ]
    });

    const presentation = mapRenderingPayloadToPresentation(payload, {}, null);
    const awardsSection = presentation.sections.find((section) => section.type === "awards");
    const award = awardsSection?.items[0];

    expect(award?.title).toBe("Top Performer Award");
    expect(award?.subtitle).toBeNull();
    expect(award?.metadata_line).toBe("2024");
  });

  it("maps references with role, organization, and contact lines", () => {
    const payload = renderingPayload();
    payload.sections.push({
      id: "references",
      type: "references",
      title: "References",
      order: 6,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "ref-1",
          type: "reference_item",
          normalized_fields: {
            name: field("Jane Doe", "Jane Doe", ["Jane Doe"]),
            job_title: field("Lead Engineer", "Lead Engineer", ["Lead Engineer"]),
            organization: field("Acme Corp", "Acme Corp", ["Acme Corp"]),
            email: field("jane@acme.com", "jane@acme.com", ["jane@acme.com"]),
            phone: field("+1 202 555 0101", "+1 202 555 0101", ["+1 202 555 0101"])
          }
        })
      ]
    });

    const presentation = mapRenderingPayloadToPresentation(payload, {}, null);
    const referencesSection = presentation.sections.find((section) => section.type === "references");
    const reference = referencesSection?.items[0];

    expect(reference?.title).toBe("Jane Doe");
    expect(reference?.subtitle).toBe("Lead Engineer • Acme Corp");
    expect(reference?.metadata_line).toBeNull();
    expect(reference?.body).toBe("jane@acme.com\n+1 202 555 0101");
  });

  it("maps medical clinical skills into competency-aware presentation items", () => {
    const payload = renderingPayload();
    payload.template.template = {
      id: "template-medical",
      name: "Medical Classic",
      slug: "medical-classic",
      status: "active",
      module_type: "medical_uk",
      preview_config: null,
      export_config: null,
      created_at: "2026-04-30T00:00:00.000Z",
      updated_at: "2026-04-30T00:00:00.000Z"
    };
    payload.sections.push({
      id: "clinical-skills",
      type: "clinical_skills",
      title: "Clinical Skills & Procedures",
      order: 5,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "skill-1",
          type: "clinical_skill",
          fields: {
            skill: "Rapid sequence induction",
            competency_level: "supervised",
            frequency: "Weekly",
            context: "Emergency theatre"
          },
          normalized_fields: {
            skill: field("Rapid sequence induction", "Rapid sequence induction", ["Rapid sequence induction"]),
            competency_level: field("supervised", "supervised", ["supervised"]),
            frequency: field("Weekly", "Weekly", ["Weekly"]),
            context: field("Emergency theatre", "Emergency theatre", ["Emergency theatre"])
          }
        })
      ]
    });

    const presentation = mapRenderingPayloadToPresentation(payload, {}, payload.template.template);
    const clinicalSkills = presentation.sections.find((section) => section.type === "clinical_skills");
    const item = clinicalSkills?.items[0];

    expect(presentation.theme.template_slug).toBe("medical-classic");
    expect(clinicalSkills?.title).toBe("Clinical Skills & Procedures");
    expect(item?.title).toBe("Rapid sequence induction");
    expect(item?.subtitle).toBe("Supervised • Weekly • Emergency theatre");
    expect(item?.body).toBeNull();
  });

  it("uses the medical extracurricular title without renaming standard volunteer sections", () => {
    const standardPayload = renderingPayload();
    standardPayload.sections.push({
      id: "volunteer",
      type: "volunteer",
      title: "Volunteer Work",
      order: 5,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "volunteer-1",
          type: "volunteer_item",
          derived: {
            headline: "Student society treasurer",
            subheadline: "Medical Society",
            bullets: [],
            date_range: null,
            location: null
          },
          plain_text: "Student society treasurer Medical Society"
        })
      ]
    });

    const standardPresentation = mapRenderingPayloadToPresentation(
      standardPayload,
      {},
      standardPayload.template.template
    );
    expect(standardPresentation.sections.find((section) => section.type === "volunteer")?.title).toBe(
      "Volunteer Work"
    );

    const medicalPayload = renderingPayload();
    medicalPayload.template.template = {
      ...medicalPayload.template.template!,
      id: "template-medical",
      name: "Medical Classic",
      slug: "medical-classic",
      module_type: "medical_uk"
    };
    medicalPayload.sections.push({
      id: "volunteer",
      type: "volunteer",
      title: "Extracurricular Activities",
      order: 5,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "volunteer-1",
          type: "volunteer_item",
          derived: {
            headline: "Student society treasurer",
            subheadline: "Medical Society",
            bullets: [],
            date_range: null,
            location: null
          },
          plain_text: "Student society treasurer Medical Society"
        })
      ]
    });

    const medicalPresentation = mapRenderingPayloadToPresentation(
      medicalPayload,
      {},
      medicalPayload.template.template
    );
    expect(medicalPresentation.sections.find((section) => section.type === "volunteer")?.title).toBe(
      "Extracurricular Activities"
    );
  });

  it("maps medical audit/QI fields into outcomes and audit metadata", () => {
    const payload = renderingPayload();
    payload.sections.push({
      id: "audit-qi",
      type: "audit_qi",
      title: "Clinical Audit & Quality Improvement",
      order: 5,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "audit-1",
          type: "audit_qi_project",
          fields: {
            title: "WHO checklist compliance",
            project_type: "audit",
            role: "Project lead",
            setting: "Surgical theatre",
            dates: "2025",
            standard_audited: "WHO surgical safety checklist",
            outcomes: ["Improved sign-out documentation", "Reduced missing checks"],
            loop_closed: true,
            presented_at: "Departmental governance meeting"
          },
          normalized_fields: {
            title: field("WHO checklist compliance", "WHO checklist compliance", ["WHO checklist compliance"]),
            project_type: field("audit", "audit", ["audit"]),
            role: field("Project lead", "Project lead", ["Project lead"]),
            setting: field("Surgical theatre", "Surgical theatre", ["Surgical theatre"]),
            dates: field("2025", "2025", ["2025"]),
            standard_audited: field(
              "WHO surgical safety checklist",
              "WHO surgical safety checklist",
              ["WHO surgical safety checklist"]
            ),
            outcomes: field(
              ["Improved sign-out documentation", "Reduced missing checks"],
              "Improved sign-out documentation Reduced missing checks",
              ["Improved sign-out documentation", "Reduced missing checks"]
            ),
            loop_closed: field(true, "true", ["true"]),
            presented_at: field(
              "Departmental governance meeting",
              "Departmental governance meeting",
              ["Departmental governance meeting"]
            )
          }
        })
      ]
    });

    const presentation = mapRenderingPayloadToPresentation(payload, {}, null);
    const auditSection = presentation.sections.find((section) => section.type === "audit_qi");
    const audit = auditSection?.items[0];

    expect(auditSection?.title).toBe("Clinical Audit & Quality Improvement");
    expect(audit?.title).toBe("WHO checklist compliance");
    expect(audit?.subtitle).toBe("Audit • Project lead • Surgical theatre");
    expect(audit?.metadata_line).toBe("2025");
    expect(audit?.body).toBe(
      "Standard audited: WHO surgical safety checklist\nPresented at: Departmental governance meeting"
    );
    expect(audit?.bullets).toEqual([
      "Improved sign-out documentation",
      "Reduced missing checks",
      "Audit loop closed"
    ]);
  });

  it("maps medical registration fields onto labeled presentation lines", () => {
    const payload = renderingPayload();
    payload.sections.push({
      id: "medical-registration",
      type: "medical_registration",
      title: "Professional Registration",
      order: 5,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "registration-1",
          type: "medical_registration",
          fields: {
            gmc_number: "1234567",
            licence_status: "Full licence to practise",
            registration_date: "08/2020",
            ntn: "LDN/123/456",
            visa_status: "Skilled Worker visa",
            additional_registrations: "• IMC (Ireland) 98765"
          },
          normalized_fields: {
            gmc_number: field("1234567", "1234567", ["1234567"]),
            licence_status: field("Full licence to practise", "Full licence to practise", ["Full licence to practise"]),
            registration_date: field("08/2020", "08/2020", ["08/2020"]),
            ntn: field("LDN/123/456", "LDN/123/456", ["LDN/123/456"]),
            visa_status: field("Skilled Worker visa", "Skilled Worker visa", ["Skilled Worker visa"]),
            additional_registrations: field("• IMC (Ireland) 98765", "• IMC (Ireland) 98765", ["• IMC (Ireland) 98765"])
          },
          plain_text: "1234567 Full licence to practise 08/2020 LDN/123/456 Skilled Worker visa"
        })
      ]
    });

    const presentation = mapRenderingPayloadToPresentation(payload, {}, null);
    const item = presentation.sections.find((section) => section.type === "medical_registration")?.items[0];

    expect(item?.title).toBe("GMC Number: 1234567");
    expect(item?.subtitle).toBe("Full licence to practise • Registered 08/2020");
    expect(item?.body).toBe("National Training Number: LDN/123/456\nRight to Work: Skilled Worker visa");
    expect(item?.bullets).toEqual(["IMC (Ireland) 98765"]);
  });

  it("maps medical qualifications without printing the qualification type", () => {
    const payload = renderingPayload();
    payload.sections.push({
      id: "medical-qualifications",
      type: "medical_qualifications",
      title: "Medical Qualifications",
      order: 5,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "qualification-1",
          type: "medical_qualification",
          fields: {
            qualification: "MBBS",
            qualification_type: "primary",
            institution: "King's College London",
            year: "2019",
            notes: "Distinction in clinical practice"
          },
          normalized_fields: {
            qualification: field("MBBS", "MBBS", ["MBBS"]),
            qualification_type: field("primary", "primary", ["primary"]),
            institution: field("King's College London", "King's College London", ["King's College London"]),
            year: field("2019", "2019", ["2019"]),
            notes: field("Distinction in clinical practice", "Distinction in clinical practice", ["Distinction in clinical practice"])
          },
          plain_text: "MBBS primary King's College London 2019"
        })
      ]
    });

    const presentation = mapRenderingPayloadToPresentation(payload, {}, null);
    const item = presentation.sections.find((section) => section.type === "medical_qualifications")?.items[0];

    expect(item?.title).toBe("MBBS");
    expect(item?.subtitle).toBe("King's College London");
    expect(item?.metadata_line).toBe("2019");
    expect(item?.body).toBe("Distinction in clinical practice");
    expect(item?.body).not.toContain("primary");
  });

  it("maps clinical experience posts with grade, place of work, duties and rota details", () => {
    const payload = renderingPayload();
    payload.sections.push({
      id: "clinical-experience",
      type: "clinical_experience",
      title: "Clinical Experience",
      order: 5,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "post-1",
          type: "clinical_post",
          fields: {
            job_title: "Foundation Doctor",
            grade: "FY2",
            specialty: "General Surgery",
            hospital: "St Mary's Hospital",
            department: "Department of Surgery",
            start_date: "08/2024",
            end_date: "",
            is_current: true,
            duties: ["Ward rounds and patient reviews", "First responder for surgical emergencies"],
            on_call_frequency: "1 in 8 full shift",
            patient_demographics: "Tertiary referral centre"
          },
          normalized_fields: {
            job_title: field("Foundation Doctor", "Foundation Doctor", ["Foundation Doctor"]),
            grade: field("FY2", "FY2", ["FY2"]),
            specialty: field("General Surgery", "General Surgery", ["General Surgery"]),
            hospital: field("St Mary's Hospital", "St Mary's Hospital", ["St Mary's Hospital"]),
            department: field("Department of Surgery", "Department of Surgery", ["Department of Surgery"]),
            start_date: field("08/2024", "08/2024", ["08/2024"]),
            end_date: field("", "", []),
            is_current: field(true, "", []),
            duties: field(
              ["Ward rounds and patient reviews", "First responder for surgical emergencies"],
              "Ward rounds and patient reviews First responder for surgical emergencies",
              ["Ward rounds and patient reviews", "First responder for surgical emergencies"]
            ),
            on_call_frequency: field("1 in 8 full shift", "1 in 8 full shift", ["1 in 8 full shift"]),
            patient_demographics: field("Tertiary referral centre", "Tertiary referral centre", ["Tertiary referral centre"])
          },
          plain_text: "Foundation Doctor FY2 General Surgery St Mary's Hospital"
        })
      ]
    });

    const presentation = mapRenderingPayloadToPresentation(payload, {}, null);
    const item = presentation.sections.find((section) => section.type === "clinical_experience")?.items[0];

    expect(item?.title).toBe("Foundation Doctor (FY2)");
    expect(item?.subtitle).toBe("General Surgery • Department of Surgery • St Mary's Hospital");
    expect(item?.date_range).toBe("08/2024 - Present");
    expect(item?.body).toBe("On-call: 1 in 8 full shift\nSetting: Tertiary referral centre");
    expect(item?.bullets).toEqual([
      "Ward rounds and patient reviews",
      "First responder for surgical emergencies"
    ]);
  });

  it("maps teaching activities and keeps audience size off the CV", () => {
    const payload = renderingPayload();
    payload.sections.push({
      id: "teaching",
      type: "teaching",
      title: "Teaching Experience",
      order: 5,
      meta: {},
      plain_text: "",
      blocks: [
        block({
          id: "teaching-1",
          type: "teaching_activity",
          fields: {
            topic: "Acute asthma management",
            setting: "Medical school",
            audience: "3rd year medical students",
            audience_size: "25",
            format: "small_group",
            frequency: "Monthly",
            evaluation: "• Average feedback 4.8/5\n• Invited back as faculty"
          },
          normalized_fields: {
            topic: field("Acute asthma management", "Acute asthma management", ["Acute asthma management"]),
            setting: field("Medical school", "Medical school", ["Medical school"]),
            audience: field("3rd year medical students", "3rd year medical students", ["3rd year medical students"]),
            audience_size: field("25", "25", ["25"]),
            format: field("small_group", "small_group", ["small_group"]),
            frequency: field("Monthly", "Monthly", ["Monthly"]),
            evaluation: field(
              "• Average feedback 4.8/5\n• Invited back as faculty",
              "• Average feedback 4.8/5 • Invited back as faculty",
              ["• Average feedback 4.8/5\n• Invited back as faculty"]
            )
          },
          plain_text: "Acute asthma management Medical school 3rd year medical students 25"
        })
      ]
    });

    const presentation = mapRenderingPayloadToPresentation(payload, {}, null);
    const item = presentation.sections.find((section) => section.type === "teaching")?.items[0];

    expect(item?.title).toBe("Acute asthma management");
    expect(item?.subtitle).toBe("Small Group • Medical school • 3rd year medical students");
    expect(item?.metadata_line).toBe("Monthly");
    expect(item?.bullets).toEqual(["Average feedback 4.8/5", "Invited back as faculty"]);
    expect(item?.subtitle).not.toContain("25");
    expect(item?.body ?? "").not.toContain("25");
  });

  it("maps courses, memberships and career gaps onto their own lines", () => {
    const payload = renderingPayload();
    payload.sections.push(
      {
        id: "courses-training",
        type: "courses_training",
        title: "Courses & Mandatory Training",
        order: 5,
        meta: {},
        plain_text: "",
        blocks: [
          block({
            id: "course-1",
            type: "course_entry",
            fields: { name: "ALS", provider: "Resuscitation Council UK", date: "03/2025", expiry_date: "03/2029" },
            normalized_fields: {
              name: field("ALS", "ALS", ["ALS"]),
              provider: field("Resuscitation Council UK", "Resuscitation Council UK", ["Resuscitation Council UK"]),
              date: field("03/2025", "03/2025", ["03/2025"]),
              expiry_date: field("03/2029", "03/2029", ["03/2029"])
            },
            plain_text: "ALS Resuscitation Council UK 03/2025 03/2029"
          })
        ]
      },
      {
        id: "memberships",
        type: "memberships",
        title: "Professional Memberships",
        order: 6,
        meta: {},
        plain_text: "",
        blocks: [
          block({
            id: "membership-1",
            type: "membership",
            fields: {
              organization: "Royal College of Physicians",
              membership_status: "Member",
              post_nominals: "MRCP(UK)",
              member_since: "2022"
            },
            normalized_fields: {
              organization: field("Royal College of Physicians", "Royal College of Physicians", ["Royal College of Physicians"]),
              membership_status: field("Member", "Member", ["Member"]),
              post_nominals: field("MRCP(UK)", "MRCP(UK)", ["MRCP(UK)"]),
              member_since: field("2022", "2022", ["2022"])
            },
            plain_text: "Royal College of Physicians Member MRCP(UK) 2022"
          })
        ]
      },
      {
        id: "career-gap",
        type: "career_gap",
        title: "Career Gaps",
        order: 7,
        meta: {},
        plain_text: "",
        blocks: [
          block({
            id: "gap-1",
            type: "career_gap",
            fields: { start_date: "01/2023", end_date: "06/2023", explanation: "Parental leave." },
            normalized_fields: {
              start_date: field("01/2023", "01/2023", ["01/2023"]),
              end_date: field("06/2023", "06/2023", ["06/2023"]),
              explanation: field("Parental leave.", "Parental leave.", ["Parental leave."])
            },
            plain_text: "01/2023 06/2023 Parental leave."
          })
        ]
      }
    );

    const presentation = mapRenderingPayloadToPresentation(payload, {}, null);

    const course = presentation.sections.find((section) => section.type === "courses_training")?.items[0];
    expect(course?.title).toBe("ALS");
    expect(course?.subtitle).toBe("Resuscitation Council UK");
    expect(course?.metadata_line).toBe("03/2025 • Valid until 03/2029");

    const membership = presentation.sections.find((section) => section.type === "memberships")?.items[0];
    expect(membership?.title).toBe("Royal College of Physicians (MRCP(UK))");
    expect(membership?.subtitle).toBe("Member");
    expect(membership?.metadata_line).toBe("Member since 2022");

    const gap = presentation.sections.find((section) => section.type === "career_gap")?.items[0];
    expect(gap?.metadata_line).toBe("01/2023 - 06/2023");
    expect(gap?.body).toBe("Parental leave.");
  });

  it("falls back to the generic mapping for medical-typed blocks with unexpected keys", () => {
    const payload = renderingPayload();
    payload.sections.push({
      id: "teaching",
      type: "teaching",
      title: "Teaching Experience",
      order: 5,
      meta: {},
      plain_text: "Ran weekly bedside teaching for medical students",
      blocks: [
        block({
          id: "teaching-import-1",
          type: "text",
          fields: { text: "Ran weekly bedside teaching for medical students" },
          normalized_fields: {
            text: field(
              "Ran weekly bedside teaching for medical students",
              "Ran weekly bedside teaching for medical students",
              ["Ran weekly bedside teaching for medical students"]
            )
          },
          derived: {
            headline: "Ran weekly bedside teaching for medical students",
            subheadline: null,
            bullets: [],
            date_range: null,
            location: null
          },
          plain_text: "Ran weekly bedside teaching for medical students"
        })
      ]
    });

    const presentation = mapRenderingPayloadToPresentation(payload, {}, null);
    const section = presentation.sections.find((entry) => entry.type === "teaching");

    expect(section?.items).toHaveLength(1);
    expect(section?.items[0]?.title).toBe("Ran weekly bedside teaching for medical students");
  });
});

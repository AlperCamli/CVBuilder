import type { CvModuleDefinition } from "./cv-module.types";

// Mirrors the hardcoded behavior of the standard CV builder (AddContentModal list,
// CVEditor defaults, SimpleCvParser section definitions). The standard code paths do
// NOT consult this definition; it exists as the registry identity for module_type
// 'standard' and as the reference shape for job-specific modules.
export const standardModule: CvModuleDefinition = {
  id: "standard",
  label: "Standard CV",
  promptProfile: null,
  templateSlugs: [
    "modern-clean",
    "minimal-professional",
    "executive-timeline",
    "creative-portfolio",
    "academic-classic",
    "latex-academic-serif",
    "latex-research-cv",
    "latex-scholar",
    "latex-two-column",
    "academic-serif-color",
    "academic-timeline",
    "creative-color-block",
    "creative-photo-hero",
    "portfolio-modern",
    "classic-monochrome",
    "tech-compact",
    "two-column-modern"
  ],
  defaultTemplateSlug: "modern-clean",
  parserSectionHints: [],
  sectionCatalog: [
    {
      type: "summary",
      title: "Professional Summary",
      essential: true,
      description: "Brief overview of your experience",
      defaultOrder: 1,
      blockType: "summary",
      fieldSchema: [{ key: "text", label: "Summary", kind: "textarea" }],
      defaultBlockFields: { text: "" }
    },
    {
      type: "experience",
      title: "Work Experience",
      essential: true,
      description: "Your employment history",
      defaultOrder: 2,
      blockType: "experience",
      fieldSchema: [
        { key: "title", label: "Job Title", kind: "text" },
        { key: "company", label: "Company", kind: "text" },
        { key: "start_date", label: "Start Date", kind: "date" },
        { key: "end_date", label: "End Date", kind: "date" },
        { key: "description", label: "Description", kind: "textarea" }
      ],
      defaultBlockFields: {}
    },
    {
      type: "education",
      title: "Education",
      essential: true,
      description: "Academic qualifications",
      defaultOrder: 3,
      blockType: "education",
      fieldSchema: [
        { key: "degree", label: "Degree", kind: "text" },
        { key: "institution", label: "Institution", kind: "text" },
        { key: "start_date", label: "Start Date", kind: "date" },
        { key: "end_date", label: "End Date", kind: "date" }
      ],
      defaultBlockFields: {}
    },
    {
      type: "skills",
      title: "Skills",
      essential: true,
      description: "Technical and soft skills",
      defaultOrder: 4,
      blockType: "skills",
      fieldSchema: [{ key: "skills", label: "Skills", kind: "bullets" }],
      defaultBlockFields: { skills: [] }
    },
    {
      type: "languages",
      title: "Languages",
      essential: false,
      description: "Languages you speak",
      defaultOrder: 5,
      blockType: "languages",
      fieldSchema: [
        { key: "language", label: "Language", kind: "text" },
        { key: "proficiency", label: "Proficiency", kind: "text" }
      ],
      defaultBlockFields: {}
    },
    {
      type: "certifications",
      title: "Certifications",
      essential: false,
      description: "Professional certificates",
      defaultOrder: 6,
      blockType: "certifications",
      fieldSchema: [
        { key: "name", label: "Certification", kind: "text" },
        { key: "issuer", label: "Issuer", kind: "text" },
        { key: "date", label: "Date", kind: "date" }
      ],
      defaultBlockFields: {}
    },
    {
      type: "courses",
      title: "Courses",
      essential: false,
      description: "Relevant courses and training",
      defaultOrder: 7,
      blockType: "courses",
      fieldSchema: [
        { key: "name", label: "Course", kind: "text" },
        { key: "provider", label: "Provider", kind: "text" },
        { key: "date", label: "Date", kind: "date" }
      ],
      defaultBlockFields: {}
    },
    {
      type: "projects",
      title: "Projects",
      essential: false,
      description: "Personal or professional projects",
      defaultOrder: 8,
      blockType: "projects",
      fieldSchema: [
        { key: "name", label: "Project", kind: "text" },
        { key: "description", label: "Description", kind: "textarea" }
      ],
      defaultBlockFields: {}
    },
    {
      type: "volunteer",
      title: "Volunteer Work",
      essential: false,
      description: "Volunteer experience",
      defaultOrder: 9,
      blockType: "volunteer",
      fieldSchema: [
        { key: "role", label: "Role", kind: "text" },
        { key: "organization", label: "Organization", kind: "text" },
        { key: "description", label: "Description", kind: "textarea" }
      ],
      defaultBlockFields: {}
    },
    {
      type: "awards",
      title: "Awards",
      essential: false,
      description: "Recognition and achievements",
      defaultOrder: 10,
      blockType: "awards",
      fieldSchema: [
        { key: "title", label: "Award", kind: "text" },
        { key: "issuer", label: "Awarding Body", kind: "text" },
        { key: "date", label: "Date", kind: "date" }
      ],
      defaultBlockFields: {}
    },
    {
      type: "publications",
      title: "Publications",
      essential: false,
      description: "Articles, papers, or books",
      defaultOrder: 11,
      blockType: "publications",
      fieldSchema: [
        { key: "title", label: "Title", kind: "text" },
        { key: "publisher", label: "Publisher / Journal", kind: "text" },
        { key: "date", label: "Date", kind: "date" }
      ],
      defaultBlockFields: {}
    },
    {
      type: "references",
      title: "References",
      essential: false,
      description: "Professional references",
      defaultOrder: 12,
      blockType: "references",
      fieldSchema: [
        { key: "name", label: "Name", kind: "text" },
        { key: "contact", label: "Contact", kind: "text" }
      ],
      defaultBlockFields: {}
    }
  ]
};

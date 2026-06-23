import type { CvModuleDefinition } from "./cv-module.types";

// Registry identity for module_type 'standard'. The standard editor never consults
// this definition (its section list and components stay hardcoded); the catalog here
// mirrors AddContentModal's contentTypes for completeness and drift checks only.
// Field schemas are intentionally empty: standard sections use bespoke components.
export const standardModule: CvModuleDefinition = {
  id: "standard",
  label: "Standard CV",
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
    "latex-modern-brief",
    "latex-editorial-sidebar",
    "latex-photo-statement",
    "latex-grant-timeline",
    "latex-technical-grid",
    "latex-two-tone-creative",
    "academic-serif-color",
    "academic-timeline",
    "creative-color-block",
    "creative-photo-hero",
    "portfolio-modern",
    "classic-monochrome",
    "tech-compact",
    "two-column-modern"
  ],
  defaultTemplateSlug: "latex-academic-serif",
  sectionCatalog: [
    { type: "summary", title: "Professional Summary", essential: true, description: "Brief overview of your experience", defaultOrder: 1, blockType: "summary", fieldSchema: [], defaultBlockFields: {} },
    { type: "experience", title: "Work Experience", essential: true, description: "Your employment history", defaultOrder: 2, blockType: "experience", fieldSchema: [], defaultBlockFields: {} },
    { type: "education", title: "Education", essential: true, description: "Academic qualifications", defaultOrder: 3, blockType: "education", fieldSchema: [], defaultBlockFields: {} },
    { type: "skills", title: "Skills", essential: true, description: "Technical and soft skills", defaultOrder: 4, blockType: "skills", fieldSchema: [], defaultBlockFields: {} },
    { type: "languages", title: "Languages", essential: false, description: "Languages you speak", defaultOrder: 5, blockType: "languages", fieldSchema: [], defaultBlockFields: {} },
    { type: "certifications", title: "Certifications", essential: false, description: "Professional certificates", defaultOrder: 6, blockType: "certifications", fieldSchema: [], defaultBlockFields: {} },
    { type: "courses", title: "Courses", essential: false, description: "Relevant courses and training", defaultOrder: 7, blockType: "courses", fieldSchema: [], defaultBlockFields: {} },
    { type: "projects", title: "Projects", essential: false, description: "Personal or professional projects", defaultOrder: 8, blockType: "projects", fieldSchema: [], defaultBlockFields: {} },
    { type: "volunteer", title: "Volunteer Work", essential: false, description: "Volunteer experience", defaultOrder: 9, blockType: "volunteer", fieldSchema: [], defaultBlockFields: {} },
    { type: "awards", title: "Awards", essential: false, description: "Recognition and achievements", defaultOrder: 10, blockType: "awards", fieldSchema: [], defaultBlockFields: {} },
    { type: "publications", title: "Publications", essential: false, description: "Articles, papers, or books", defaultOrder: 11, blockType: "publications", fieldSchema: [], defaultBlockFields: {} },
    { type: "references", title: "References", essential: false, description: "Professional references", defaultOrder: 12, blockType: "references", fieldSchema: [], defaultBlockFields: {} }
  ]
};

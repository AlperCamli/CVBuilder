// Preview-only field placeholders. Before the editor requests a rendering preview, empty
// fields get filled with their label wrapped in marker brackets, so the preview shows
// where each field lands on the template before the user writes anything. The markers are
// detected by CVPresentationPreview and rendered with lower contrast. The injected content
// is only ever sent to the preview endpoint — saved content (and therefore every export)
// never contains placeholders.

import type { CvBlock, CvContent, CvJsonValue } from "./api-types";
import { getModuleManagedSectionDefinition } from "../modules/module-registry";
import type { SectionTypeDefinition } from "../modules/cv-module.types";

export const PLACEHOLDER_OPEN = "⟪";
export const PLACEHOLDER_CLOSE = "⟫";

// Matches one marked placeholder segment inside presentation text.
export const PLACEHOLDER_SEGMENT_RE = /⟪([^⟫]*)⟫/g;

const mark = (text: string): string => `${PLACEHOLDER_OPEN}${text}${PLACEHOLDER_CLOSE}`;

interface SectionPlaceholders {
  blockType: string;
  // string -> text field placeholder; string[] -> bullet-list field placeholder entries.
  fields: Record<string, string | string[]>;
}

const METADATA_PLACEHOLDERS: Record<string, string> = {
  full_name: "Your Name",
  headline: "Professional Title",
  email: "email@example.com",
  phone: "Phone Number",
  location: "City, Country"
};

// Field keys must match what editorSectionsToCvContent writes for each standard section.
const STANDARD_PLACEHOLDERS: Record<string, SectionPlaceholders> = {
  summary: {
    blockType: "summary",
    fields: { text: "A few sentences about your experience, strengths and career goals" }
  },
  experience: {
    blockType: "experience_item",
    fields: {
      role: "Job Title",
      company: "Company",
      location: "Location",
      start_date: "Start Date",
      end_date: "End Date",
      description: "Describe your responsibilities and achievements"
    }
  },
  education: {
    blockType: "education_item",
    fields: {
      degree: "Degree",
      institution: "Institution",
      field_of_study: "Field of Study",
      gpa: "GPA",
      start_date: "Start Date",
      end_date: "End Date",
      description: "Notes, honours or relevant coursework"
    }
  },
  skills: {
    blockType: "skills",
    fields: { skills: ["Skill 1", "Skill 2", "Skill 3"] }
  },
  languages: {
    blockType: "language_item",
    fields: { language: "Language", proficiency: "Proficiency" }
  },
  certifications: {
    blockType: "certification_item",
    fields: { name: "Certification Name", url: "URL" }
  },
  courses: {
    blockType: "course_item",
    fields: { title: "Course Title", institution: "Institution", description: "What the course covered" }
  },
  projects: {
    blockType: "project_item",
    fields: {
      title: "Project Title",
      subtitle: "Subtitle / Tech Stack",
      start_date: "Start Date",
      end_date: "End Date",
      description: "Describe the project and your contribution"
    }
  },
  volunteer: {
    blockType: "volunteer_item",
    fields: {
      role: "Role",
      organization: "Organization",
      location: "Location",
      start_date: "Start Date",
      end_date: "End Date",
      description: "Describe your contribution"
    }
  },
  awards: {
    blockType: "award_item",
    fields: { name: "Award Name", issuer: "Issuer", date: "Date", description: "What it recognises" }
  },
  publications: {
    blockType: "publication_item",
    fields: { title: "Publication Title", publisher: "Publisher / Journal", date: "Date", description: "Citation or summary" }
  },
  references: {
    blockType: "reference_item",
    fields: {
      name: "Referee Name",
      job_title: "Job Title",
      organization: "Organization",
      email: "Email",
      phone: "Phone"
    }
  }
};

const customSectionPlaceholders = (sectionType: string): SectionPlaceholders => ({
  blockType: `${sectionType || "custom"}_item`,
  fields: { title: "Title", subtitle: "Subtitle", description: "Description", date: "Date" }
});

// Module-managed sections (e.g. medical_uk) derive placeholders from their field schema,
// so the placeholder text matches the editor's input labels. Booleans never render as
// text, and fields the presentation mapper keeps off the CV simply produce no output.
const placeholdersFromFieldSchema = (definition: SectionTypeDefinition): SectionPlaceholders => {
  const fields: Record<string, string | string[]> = {};

  for (const field of definition.fieldSchema) {
    if (field.kind === "boolean") {
      continue;
    }

    const label = field.placeholder ?? field.label;
    fields[field.key] = field.kind === "bullets" ? [label] : label;
  }

  return { blockType: definition.blockType, fields };
};

const resolveSectionPlaceholders = (
  sectionType: string,
  moduleType: string | null | undefined
): SectionPlaceholders => {
  const moduleDefinition = getModuleManagedSectionDefinition(moduleType, sectionType);
  if (moduleDefinition && moduleDefinition.fieldSchema.length > 0) {
    return placeholdersFromFieldSchema(moduleDefinition);
  }

  return STANDARD_PLACEHOLDERS[sectionType] ?? customSectionPlaceholders(sectionType);
};

const isEmptyValue = (value: CvJsonValue | undefined): boolean => {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.every((item) => typeof item === "string" ? item.trim().length === 0 : item === null);
  }

  return false;
};

const toPlaceholderValue = (placeholder: string | string[]): CvJsonValue =>
  Array.isArray(placeholder) ? placeholder.map((entry) => mark(entry)) : mark(placeholder);

const buildPlaceholderBlock = (sectionType: string, entry: SectionPlaceholders): CvBlock => {
  const fields: Record<string, CvJsonValue> = {};
  for (const [key, placeholder] of Object.entries(entry.fields)) {
    fields[key] = toPlaceholderValue(placeholder);
  }

  return {
    id: `placeholder-${sectionType}`,
    type: entry.blockType,
    order: 0,
    visibility: "visible",
    fields,
    meta: {}
  };
};

export const injectPreviewPlaceholders = (
  content: CvContent,
  moduleType: string | null | undefined
): CvContent => {
  const next: CvContent = JSON.parse(JSON.stringify(content));

  for (const [key, placeholder] of Object.entries(METADATA_PLACEHOLDERS)) {
    if (isEmptyValue(next.metadata[key])) {
      next.metadata[key] = mark(placeholder);
    }
  }

  for (const section of next.sections) {
    if (section.meta?.visibility === "hidden") {
      continue;
    }

    const entry = resolveSectionPlaceholders(section.type, moduleType);

    if (section.blocks.length === 0) {
      section.blocks.push(buildPlaceholderBlock(section.type, entry));
      continue;
    }

    for (const block of section.blocks) {
      if (block.visibility === "hidden") {
        continue;
      }

      for (const [key, placeholder] of Object.entries(entry.fields)) {
        if (isEmptyValue(block.fields[key])) {
          block.fields[key] = toPlaceholderValue(placeholder);
        }
      }
    }
  }

  return next;
};

import type { CvJsonValue } from "../cv-content/cv-content.types";

export type FieldDescriptorKind = "text" | "textarea" | "date" | "select" | "bullets" | "boolean";

export interface FieldDescriptor {
  key: string;
  label: string;
  kind: FieldDescriptorKind;
  options?: string[];
  required?: boolean;
}

export interface SectionTypeDefinition {
  type: string;
  title: string;
  essential: boolean;
  description: string;
  defaultOrder: number;
  blockType: string;
  fieldSchema: FieldDescriptor[];
  defaultBlockFields: Record<string, CvJsonValue>;
}

export interface ParserSectionHint {
  type: string;
  title: string;
  aliases: string[];
  keywords: string[];
}

export interface ModuleValidationRules {
  discouragePhoto?: boolean;
  discouragedMetadataFields?: string[];
}

export interface CvModuleDefinition {
  id: string;
  label: string;
  promptProfile: string | null;
  sectionCatalog: SectionTypeDefinition[];
  parserSectionHints: ParserSectionHint[];
  templateSlugs: string[];
  defaultTemplateSlug: string | null;
  validation?: ModuleValidationRules;
}

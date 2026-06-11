// Frontend mirror of backend/src/shared/cv-modules/cv-module.types.ts.
// The shared contract between the two registries is the set of section type ids,
// block types and field descriptor keys per module; keep them in sync.

export type FieldDescriptorKind = "text" | "textarea" | "date" | "select" | "bullets" | "boolean";

export interface FieldDescriptor {
  key: string;
  label: string;
  kind: FieldDescriptorKind;
  options?: string[];
  required?: boolean;
  placeholder?: string;
}

export interface SectionTypeDefinition {
  type: string;
  title: string;
  essential: boolean;
  description: string;
  defaultOrder: number;
  blockType: string;
  fieldSchema: FieldDescriptor[];
  defaultBlockFields: Record<string, unknown>;
}

export interface CvModuleDefinition {
  id: string;
  label: string;
  sectionCatalog: SectionTypeDefinition[];
  templateSlugs: string[];
  defaultTemplateSlug: string | null;
  validation?: {
    discouragePhoto?: boolean;
    discouragedMetadataFields?: string[];
  };
}

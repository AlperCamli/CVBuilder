import type { CvModuleDefinition, SectionTypeDefinition } from "./cv-module.types";
import { standardModule } from "./standard.module";
import { medicalUkModule } from "./medical-uk.module";

export const DEFAULT_MODULE_ID = "standard";

const MODULES: Record<string, CvModuleDefinition> = {
  [standardModule.id]: standardModule,
  [medicalUkModule.id]: medicalUkModule
};

export const isKnownCvModule = (id: string): boolean => {
  return Object.prototype.hasOwnProperty.call(MODULES, id);
};

// Unknown or missing module ids degrade to the standard module so legacy rows and
// garbage values can never break a request.
export const getCvModule = (id: string | null | undefined): CvModuleDefinition => {
  if (!id || !isKnownCvModule(id)) {
    return MODULES[DEFAULT_MODULE_ID];
  }

  return MODULES[id];
};

export const listCvModules = (): CvModuleDefinition[] => {
  return Object.values(MODULES);
};

// Section type ids the standard editor and AI flows handle with bespoke logic.
// Module section types matching one of these keep the standard behavior.
export const STANDARD_SECTION_TYPES = new Set(
  standardModule.sectionCatalog.map((definition) => definition.type)
);

export interface ModuleBlockAiPolicy {
  sectionType: string;
  definition: SectionTypeDefinition;
  // The only fields AI may rewrite for this block type.
  editableFields: string[];
  // Remaining fieldSchema keys: read-only facts the model may use as context.
  factFields: string[];
}

export type ModuleBlockAiPolicyResolution =
  | { mode: "standard" }
  | { mode: "disabled"; sectionType: string }
  | { mode: "facts_guarded"; policy: ModuleBlockAiPolicy };

// Resolves the block-suggest AI policy for a block type within a module. Standard
// module (or unknown module) blocks, and module section types that reuse the
// standard path, resolve to "standard". Module-managed blocks resolve to
// "facts_guarded" when the section declares aiSuggest, otherwise "disabled".
export const resolveModuleBlockAiPolicy = (
  moduleId: string | null | undefined,
  blockType: string
): ModuleBlockAiPolicyResolution => {
  if (!moduleId || moduleId === DEFAULT_MODULE_ID || !isKnownCvModule(moduleId)) {
    return { mode: "standard" };
  }

  const definition = MODULES[moduleId].sectionCatalog.find(
    (entry) => entry.blockType === blockType && !STANDARD_SECTION_TYPES.has(entry.type)
  );

  if (!definition) {
    return { mode: "standard" };
  }

  const editableFields = definition.aiSuggest?.editableFields ?? [];
  if (editableFields.length === 0) {
    return { mode: "disabled", sectionType: definition.type };
  }

  return {
    mode: "facts_guarded",
    policy: {
      sectionType: definition.type,
      definition,
      editableFields,
      factFields: definition.fieldSchema
        .map((field) => field.key)
        .filter((key) => !editableFields.includes(key))
    }
  };
};

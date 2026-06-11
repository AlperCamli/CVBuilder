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

export const getCvModule = (id: string | null | undefined): CvModuleDefinition => {
  if (!id || !isKnownCvModule(id)) {
    return MODULES[DEFAULT_MODULE_ID];
  }

  return MODULES[id];
};

// Section type ids that the standard editor handles with bespoke components and
// per-type mapper branches. Module section types matching one of these reuse the
// standard path; everything else goes through the descriptor-driven ModuleSection.
export const STANDARD_SECTION_TYPES = new Set(
  standardModule.sectionCatalog.map((definition) => definition.type)
);

// Returns the module section definition for types that need descriptor-driven
// handling. Returns null for the standard module, for standard-handled types, and
// for types the module does not define — callers fall through to existing behavior.
export const getModuleManagedSectionDefinition = (
  moduleId: string | null | undefined,
  sectionType: string
): SectionTypeDefinition | null => {
  if (!moduleId || moduleId === DEFAULT_MODULE_ID) {
    return null;
  }

  if (STANDARD_SECTION_TYPES.has(sectionType)) {
    return null;
  }

  const cvModule = getCvModule(moduleId);
  return cvModule.sectionCatalog.find((definition) => definition.type === sectionType) ?? null;
};

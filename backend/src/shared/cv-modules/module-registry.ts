import type { CvModuleDefinition } from "./cv-module.types";
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

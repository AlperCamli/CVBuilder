import { describe, expect, it } from "vitest";
import { medicalUkModule as backendMedicalUk } from "../src/shared/cv-modules/medical-uk.module";
import { standardModule as backendStandard } from "../src/shared/cv-modules/standard.module";
import { medicalUkModule as frontendMedicalUk } from "../../frontend/src/app/modules/medical-uk.module";
import { standardModule as frontendStandard } from "../../frontend/src/app/modules/standard.module";

// Drift guard for the mirrored module registries: the shared contract between
// backend/src/shared/cv-modules and frontend/src/app/modules is the set of section
// type ids, block types, and field descriptor keys per module. A failure here means
// one mirror was updated without the other.

const sectionTypes = (catalog: Array<{ type: string }>): string[] =>
  [...catalog.map((definition) => definition.type)].sort();

describe("cv module registry drift guard", () => {
  it("keeps medical_uk section types in sync between backend and frontend", () => {
    expect(sectionTypes(frontendMedicalUk.sectionCatalog)).toEqual(
      sectionTypes(backendMedicalUk.sectionCatalog)
    );
  });

  it("keeps medical_uk block types and field keys in sync between backend and frontend", () => {
    const backendByType = new Map(
      backendMedicalUk.sectionCatalog.map((definition) => [definition.type, definition])
    );
    // Types handled by bespoke standard components: the frontend mirror leaves their
    // fieldSchema intentionally empty, so only blockType is part of the contract.
    const standardHandledTypes = new Set(sectionTypes(frontendStandard.sectionCatalog));

    for (const frontendDefinition of frontendMedicalUk.sectionCatalog) {
      const backendDefinition = backendByType.get(frontendDefinition.type);
      expect(backendDefinition, `backend is missing section type ${frontendDefinition.type}`).toBeDefined();
      expect(frontendDefinition.blockType).toBe(backendDefinition!.blockType);

      if (standardHandledTypes.has(frontendDefinition.type)) {
        continue;
      }

      const backendFieldKeys = backendDefinition!.fieldSchema.map((field) => field.key).sort();
      const frontendFieldKeys = frontendDefinition.fieldSchema.map((field) => field.key).sort();
      expect(frontendFieldKeys, `field keys diverged for ${frontendDefinition.type}`).toEqual(
        backendFieldKeys
      );
    }
  });

  it("keeps medical_uk template slugs and module ids in sync", () => {
    expect(frontendMedicalUk.id).toBe(backendMedicalUk.id);
    expect([...frontendMedicalUk.templateSlugs].sort()).toEqual(
      [...backendMedicalUk.templateSlugs].sort()
    );
    expect(frontendMedicalUk.defaultTemplateSlug).toBe(backendMedicalUk.defaultTemplateSlug);
  });

  it("keeps standard section types in sync between backend and frontend", () => {
    expect(sectionTypes(frontendStandard.sectionCatalog)).toEqual(
      sectionTypes(backendStandard.sectionCatalog)
    );
  });
});

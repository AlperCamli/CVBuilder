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

  it("keeps medical_uk aiSuggest policies in sync and limited to schema fields", () => {
    const backendByType = new Map(
      backendMedicalUk.sectionCatalog.map((definition) => [definition.type, definition])
    );
    const standardHandledTypes = new Set(sectionTypes(frontendStandard.sectionCatalog));

    for (const frontendDefinition of frontendMedicalUk.sectionCatalog) {
      const backendDefinition = backendByType.get(frontendDefinition.type);
      expect(backendDefinition, `backend is missing section type ${frontendDefinition.type}`).toBeDefined();

      const frontendEditable = [...(frontendDefinition.aiSuggest?.editableFields ?? [])].sort();
      const backendEditable = [...(backendDefinition!.aiSuggest?.editableFields ?? [])].sort();
      expect(frontendEditable, `aiSuggest diverged for ${frontendDefinition.type}`).toEqual(
        backendEditable
      );

      if (standardHandledTypes.has(frontendDefinition.type)) {
        // Standard-handled types keep the standard AI behavior; module policy must stay off.
        expect(backendEditable).toEqual([]);
        continue;
      }

      const backendFieldKeys = new Set(backendDefinition!.fieldSchema.map((field) => field.key));
      for (const key of backendEditable) {
        expect(backendFieldKeys.has(key), `editable field ${key} missing from ${frontendDefinition.type} schema`).toBe(true);
      }
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

  it("keeps standard template slugs and default template in sync", () => {
    expect(frontendStandard.id).toBe(backendStandard.id);
    expect([...frontendStandard.templateSlugs].sort()).toEqual(
      [...backendStandard.templateSlugs].sort()
    );
    expect(frontendStandard.defaultTemplateSlug).toBe(backendStandard.defaultTemplateSlug);
  });
});

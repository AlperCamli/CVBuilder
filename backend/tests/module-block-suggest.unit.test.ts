import { describe, expect, it } from "vitest";
import { resolveModuleBlockAiPolicy } from "../src/shared/cv-modules/module-registry";
import {
  buildModuleBlockSuggestPayload,
  buildModuleBlockSuggestUserPrompt,
  enforceModuleBlockAiPolicy
} from "../src/modules/ai/module-block-suggest";
import { AiFlowFailedError } from "../src/shared/errors/app-error";
import type { CvBlock } from "../src/shared/cv-content/cv-content.types";

const requirePolicy = (blockType: string) => {
  const resolution = resolveModuleBlockAiPolicy("medical_uk", blockType);
  if (resolution.mode !== "facts_guarded") {
    throw new Error(`expected facts_guarded for ${blockType}, got ${resolution.mode}`);
  }
  return resolution.policy;
};

const block = (type: string, fields: CvBlock["fields"]): CvBlock => ({
  id: `${type}-1`,
  type,
  order: 0,
  visibility: "visible",
  fields,
  meta: { revision_anchor: null }
});

describe("resolveModuleBlockAiPolicy", () => {
  it("returns standard mode for the standard module and unknown modules", () => {
    expect(resolveModuleBlockAiPolicy("standard", "experience_item")).toEqual({ mode: "standard" });
    expect(resolveModuleBlockAiPolicy(null, "clinical_post")).toEqual({ mode: "standard" });
    expect(resolveModuleBlockAiPolicy("nope", "clinical_post")).toEqual({ mode: "standard" });
  });

  it("returns standard mode for medical block types handled by the standard path", () => {
    for (const blockType of ["summary", "publications", "awards", "volunteer_item", "references"]) {
      expect(resolveModuleBlockAiPolicy("medical_uk", blockType)).toEqual({ mode: "standard" });
    }
  });

  it("disables AI for fact-only medical sections", () => {
    for (const blockType of ["medical_registration", "course_entry", "membership", "interests"]) {
      const resolution = resolveModuleBlockAiPolicy("medical_uk", blockType);
      expect(resolution.mode, blockType).toBe("disabled");
    }
  });

  it("guards facts for the AI-enabled medical sections", () => {
    const expected: Record<string, string[]> = {
      medical_qualification: ["notes"],
      clinical_post: ["duties"],
      career_gap: ["explanation"],
      clinical_skill: ["context"],
      additional_skill: ["context"],
      audit_qi_project: ["outcomes"],
      teaching_activity: ["evaluation"],
      management_role: ["description"]
    };

    for (const [blockType, editableFields] of Object.entries(expected)) {
      const policy = requirePolicy(blockType);
      expect(policy.editableFields, blockType).toEqual(editableFields);
      for (const field of editableFields) {
        expect(policy.factFields, blockType).not.toContain(field);
      }
      expect(policy.factFields.length).toBeGreaterThan(0);
    }
  });
});

describe("buildModuleBlockSuggestPayload", () => {
  it("sends only non-empty schema fields plus the editable field list", () => {
    const policy = requirePolicy("teaching_activity");
    const payload = buildModuleBlockSuggestPayload({
      actionType: "improve",
      block: block("teaching_activity", {
        topic: "Acute asthma management",
        setting: "",
        audience: "3rd year medical students",
        audience_size: "25",
        format: "",
        frequency: "",
        evaluation: "",
        legacy_field: "should not be sent"
      }),
      policy,
      userInstruction: "",
      jobDescription: ""
    });

    expect(payload).toEqual({
      action_type: "improve",
      block: {
        type: "teaching_activity",
        fields: {
          topic: "Acute asthma management",
          audience: "3rd year medical students",
          audience_size: "25"
        }
      },
      editable_fields: ["evaluation"]
    });
  });

  it("includes trimmed user instruction and job description only when present", () => {
    const policy = requirePolicy("clinical_post");
    const payload = buildModuleBlockSuggestPayload({
      actionType: "expand",
      block: block("clinical_post", { job_title: "Foundation Doctor", duties: ["Ward rounds"] }),
      policy,
      userInstruction: "  emphasise leadership  ",
      jobDescription: "Job ad text"
    });

    expect(payload.user_instruction).toBe("emphasise leadership");
    expect(payload.job_description).toBe("Job ad text");
  });
});

describe("buildModuleBlockSuggestUserPrompt", () => {
  it("names the section title, action and editable fields", () => {
    const policy = requirePolicy("medical_qualification");
    const prompt = buildModuleBlockSuggestUserPrompt({ actionType: "improve", policy });

    expect(prompt).toContain("Medical Qualifications");
    expect(prompt).toContain("improve");
    expect(prompt).toContain("notes");
    expect(prompt).toContain("read-only fact");
  });
});

describe("enforceModuleBlockAiPolicy", () => {
  it("restores fact fields the model tried to change and applies the editable field", () => {
    const policy = requirePolicy("medical_qualification");
    const current = block("medical_qualification", {
      qualification: "MBBS",
      qualification_type: "primary",
      institution: "King's College London",
      year: "2019",
      notes: ""
    });

    const enforced = enforceModuleBlockAiPolicy({
      currentBlock: current,
      suggestedBlock: {
        fields: {
          qualification: "MBBS with Honours (hallucinated)",
          institution: "Oxford (hallucinated)",
          year: "2017",
          notes: "Achieved distinction in clinical practice."
        }
      },
      policy
    });

    expect(enforced.id).toBe(current.id);
    expect(enforced.meta).toEqual(current.meta);
    expect(enforced.fields.qualification).toBe("MBBS");
    expect(enforced.fields.institution).toBe("King's College London");
    expect(enforced.fields.year).toBe("2019");
    expect(enforced.fields.notes).toBe("Achieved distinction in clinical practice.");
  });

  it("coerces a string answer into an array for bullets-kind fields", () => {
    const policy = requirePolicy("clinical_post");
    const current = block("clinical_post", {
      job_title: "Foundation Doctor",
      grade: "FY2",
      duties: ["Old duty"]
    });

    const enforced = enforceModuleBlockAiPolicy({
      currentBlock: current,
      suggestedBlock: {
        fields: {
          grade: "Consultant",
          duties: "- Led ward rounds for 20 patients\n• Coordinated discharge planning"
        }
      },
      policy
    });

    expect(enforced.fields.grade).toBe("FY2");
    expect(enforced.fields.duties).toEqual([
      "Led ward rounds for 20 patients",
      "Coordinated discharge planning"
    ]);
  });

  it("coerces an array answer into the bullet-line string convention for textarea fields", () => {
    const policy = requirePolicy("medical_qualification");
    const current = block("medical_qualification", { qualification: "MRCP", notes: "" });

    const enforced = enforceModuleBlockAiPolicy({
      currentBlock: current,
      suggestedBlock: { fields: { notes: ["Passed first attempt", "Top decile score"] } },
      policy
    });

    expect(enforced.fields.notes).toBe("• Passed first attempt\n• Top decile score");
  });

  it("reads fields from the suggested block top level when not nested", () => {
    const policy = requirePolicy("career_gap");
    const current = block("career_gap", { start_date: "01/2023", end_date: "06/2023", explanation: "old" });

    const enforced = enforceModuleBlockAiPolicy({
      currentBlock: current,
      suggestedBlock: { explanation: "Parental leave; maintained CPD via e-learning." },
      policy
    });

    expect(enforced.fields.explanation).toBe("Parental leave; maintained CPD via e-learning.");
    expect(enforced.fields.start_date).toBe("01/2023");
  });

  it("throws when the model returns no usable editable field", () => {
    const policy = requirePolicy("teaching_activity");
    const current = block("teaching_activity", { topic: "Asthma", evaluation: "" });

    expect(() =>
      enforceModuleBlockAiPolicy({
        currentBlock: current,
        suggestedBlock: { fields: { topic: "Changed topic", evaluation: "   " } },
        policy
      })
    ).toThrow(AiFlowFailedError);
  });
});

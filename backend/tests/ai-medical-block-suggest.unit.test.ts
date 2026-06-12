import { describe, expect, it, vi } from "vitest";
import { AiService } from "../src/modules/ai/ai.service";
import { ConflictError } from "../src/shared/errors/app-error";
import type { SessionContext } from "../src/modules/ai/ai.types";
import type { AiRepository } from "../src/modules/ai/ai.repository";
import type { BillingService } from "../src/modules/billing/billing.service";
import type { CvRevisionsService } from "../src/modules/cv-revisions/cv-revisions.service";
import type { JobsRepository } from "../src/modules/jobs/jobs.repository";
import type { MasterCvRepository } from "../src/modules/master-cv/master-cv.repository";
import type { TailoredCvRepository } from "../src/modules/tailored-cv/tailored-cv.repository";
import type { TemplatesService } from "../src/modules/templates/templates.service";
import type { AiPromptResolver } from "../src/modules/ai/prompts/prompt-resolver";
import type { AiProvider } from "../src/modules/ai/provider/ai-provider";
import type { CvBlock } from "../src/shared/cv-content/cv-content.types";
import type { MasterCvRecord } from "../src/shared/types/domain";

const NOW = "2026-06-12T10:00:00.000Z";

const session: SessionContext = {
  authUser: {
    auth_user_id: "auth-1",
    email: "user@example.com",
    full_name: "User",
    locale: "en"
  },
  appUser: {
    id: "user-1",
    auth_user_id: "auth-1",
    email: "user@example.com",
    full_name: "User",
    locale: "en",
    default_cv_language: "en",
    onboarding_completed: true,
    created_at: NOW,
    updated_at: NOW
  }
};

const createMedicalMasterCv = (): MasterCvRecord =>
  ({
    id: "master-1",
    user_id: "user-1",
    title: "Medical CV",
    language: "en",
    module_type: "medical_uk",
    template_id: null,
    summary_text: null,
    source_type: "scratch",
    is_deleted: false,
    created_at: NOW,
    updated_at: NOW,
    current_content: {
      version: "v1",
      language: "en",
      metadata: {},
      sections: [
        {
          id: "registration-section",
          type: "medical_registration",
          title: "Professional Registration",
          order: 0,
          meta: {},
          blocks: [
            {
              id: "registration-block",
              type: "medical_registration",
              order: 0,
              visibility: "visible",
              fields: { gmc_number: "1234567", licence_status: "Full licence to practise" },
              meta: {}
            }
          ]
        },
        {
          id: "qualifications-section",
          type: "medical_qualifications",
          title: "Medical Qualifications",
          order: 1,
          meta: {},
          blocks: [
            {
              id: "qualification-block",
              type: "medical_qualification",
              order: 0,
              visibility: "visible",
              fields: {
                qualification: "MBBS",
                qualification_type: "primary",
                institution: "King's College London",
                year: "2019",
                notes: ""
              },
              meta: {}
            }
          ]
        },
        {
          id: "additional-skills-section",
          type: "additional_skills",
          title: "Additional Skills",
          order: 2,
          meta: {},
          blocks: [
            {
              id: "additional-skill-block",
              type: "additional_skill",
              order: 0,
              visibility: "visible",
              fields: { skill: "Clinical audit leadership", context: "" },
              meta: {}
            }
          ]
        }
      ]
    }
  }) as unknown as MasterCvRecord;

const makeService = (masterCv: MasterCvRecord) => {
  const createSuggestions = vi.fn().mockImplementation(async (payloads: Array<Record<string, unknown>>) => {
    return payloads.map((payload, index) => ({
      id: `s-${index + 1}`,
      ai_run_id: String(payload.ai_run_id),
      user_id: "user-1",
      master_cv_id: "master-1",
      tailored_cv_id: null,
      block_id: String(payload.block_id),
      action_type: "improve",
      before_content: payload.before_content as Record<string, unknown>,
      suggested_content: payload.suggested_content as Record<string, unknown>,
      option_group_key: null,
      status: payload.status ?? "pending",
      applied_at: payload.applied_at ?? null,
      created_at: NOW
    }));
  });

  const updateById = vi.fn().mockImplementation(async (_userId, _masterCvId, patch) => ({
    ...masterCv,
    ...patch,
    updated_at: NOW
  }));

  const service = new AiService(
    { createSuggestions } as unknown as AiRepository,
    {
      providerName: "mock",
      resolveModelName: vi.fn().mockReturnValue("mock-model"),
      generate: vi.fn()
    } as unknown as AiProvider,
    {
      findById: vi.fn().mockResolvedValue(masterCv),
      updateById
    } as unknown as MasterCvRepository,
    {} as TailoredCvRepository,
    {} as JobsRepository,
    {
      createMasterBlockRevision: vi.fn().mockResolvedValue({})
    } as unknown as CvRevisionsService,
    {} as TemplatesService,
    { resolve: vi.fn() } as unknown as AiPromptResolver,
    {
      assertActionAllowed: vi.fn().mockResolvedValue(undefined),
      getCurrentPlanSummary: vi.fn().mockResolvedValue({ plan_code: "pro" }),
      recordAiActionUsage: vi.fn().mockResolvedValue(undefined)
    } as unknown as BillingService
  );

  return { service, createSuggestions, updateById };
};

const spyExecuteFlow = (service: AiService, output: Record<string, unknown>) => {
  return vi
    .spyOn(service as unknown as { executeFlow: Function }, "executeFlow")
    .mockResolvedValue({ ai_run: { id: "run-1" }, output });
};

describe("AiService medical block suggestions", () => {
  it("rejects AI for fact-only medical sections", async () => {
    const { service } = makeService(createMedicalMasterCv());

    await expect(
      service.suggestBlock(session, {
        master_cv_id: "master-1",
        block_id: "registration-block",
        action_type: "improve"
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("keeps medical additional_skill blocks out of the skills-pool branch and guards facts", async () => {
    const { service, createSuggestions } = makeService(createMedicalMasterCv());
    const executeFlow = spyExecuteFlow(service, {
      suggested_block: {
        fields: {
          skill: "Hallucinated skill name",
          context: "Led the departmental audit programme across two rotations."
        }
      }
    });

    const applied = await service.suggestBlock(session, {
      master_cv_id: "master-1",
      block_id: "additional-skill-block",
      action_type: "improve"
    });

    // The skills-pool branch would have demanded fields.skills; the module branch ran instead.
    const flowInput = executeFlow.mock.calls[0][0] as Record<string, unknown>;
    expect(flowInput.flow_type).toBe("block_suggest");
    expect(flowInput.prompt_profile).toBe("medical_uk");
    const inputPayload = flowInput.input_payload as Record<string, unknown>;
    expect(inputPayload.editable_fields).toEqual(["context"]);
    expect((inputPayload.block as Record<string, unknown>).fields).toEqual({
      skill: "Clinical audit leadership"
    });

    const updatedBlock = applied.updated_block as CvBlock;
    expect(updatedBlock.fields.skill).toBe("Clinical audit leadership");
    expect(updatedBlock.fields.context).toBe(
      "Led the departmental audit programme across two rotations."
    );
    expect(createSuggestions).toHaveBeenCalledTimes(1);
  });

  it("restores fact fields on qualification blocks and bulletizes notes", async () => {
    const { service } = makeService(createMedicalMasterCv());
    spyExecuteFlow(service, {
      suggested_block: {
        fields: {
          qualification: "MBBS with Distinction (hallucinated)",
          year: "2017",
          notes: "- Distinction in clinical practice\n- Elective in emergency medicine"
        }
      }
    });

    const applied = await service.suggestBlock(session, {
      master_cv_id: "master-1",
      block_id: "qualification-block",
      action_type: "improve"
    });

    const updatedBlock = applied.updated_block as CvBlock;
    expect(updatedBlock.fields.qualification).toBe("MBBS");
    expect(updatedBlock.fields.year).toBe("2019");
    expect(updatedBlock.fields.qualification_type).toBe("primary");
    expect(updatedBlock.fields.notes).toBe(
      "• Distinction in clinical practice\n• Elective in emergency medicine"
    );
  });
});

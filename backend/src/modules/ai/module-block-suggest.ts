import { AiFlowFailedError } from "../../shared/errors/app-error";
import { addBulletPrefix, stripBulletPrefix } from "../../shared/cv-content/bullet-text";
import { normalizeCvJsonRecord } from "../../shared/cv-content/cv-content.utils";
import type { CvBlock, CvJsonValue } from "../../shared/cv-content/cv-content.types";
import type { ModuleBlockAiPolicy } from "../../shared/cv-modules/module-registry";
import type { AiSuggestionActionType } from "../../shared/types/domain";
import { removeEmptyFields } from "./empty-fields";

// Pure helpers behind module-scoped (facts_guarded) block suggestions. The model only
// receives the block's non-empty schema fields plus the list of fields it may rewrite;
// enforceModuleBlockAiPolicy then guarantees that nothing outside that list can change,
// regardless of what the model returns.

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const asTrimmedString = (value: unknown): string => {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return "";
};

// Editable bullets-kind fields must round-trip as arrays of plain bullet strings.
const toBulletArray = (value: unknown): string[] | null => {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => stripBulletPrefix(asTrimmedString(item)))
      .filter((item) => item.length > 0);
    return items.length > 0 ? items : null;
  }

  const text = asTrimmedString(value);
  if (!text) {
    return null;
  }

  const items = text
    .split(/\r?\n/)
    .map((line) => stripBulletPrefix(line))
    .filter((line) => line.length > 0);
  return items.length > 0 ? items : null;
};

// Editable textarea/text fields must round-trip as a single string; an array answer
// is folded into the editor's "• " bullet-line convention.
const toNarrativeString = (value: unknown): string | null => {
  if (Array.isArray(value)) {
    const lines = value
      .map((item) => asTrimmedString(item))
      .filter((item) => item.length > 0)
      .map((item) => addBulletPrefix(item));
    return lines.length > 0 ? lines.join("\n") : null;
  }

  const text = asTrimmedString(value);
  return text.length > 0 ? text : null;
};

export const buildModuleBlockSuggestPayload = (options: {
  actionType: AiSuggestionActionType;
  block: CvBlock;
  policy: ModuleBlockAiPolicy;
  userInstruction: string;
  jobDescription: string;
}): Record<string, unknown> => {
  const { actionType, block, policy, userInstruction, jobDescription } = options;

  const schemaKeys = new Set([...policy.factFields, ...policy.editableFields]);
  const schemaFields: Record<string, CvJsonValue> = {};
  for (const [key, value] of Object.entries(block.fields)) {
    if (schemaKeys.has(key)) {
      schemaFields[key] = value;
    }
  }

  return {
    action_type: actionType,
    block: {
      type: block.type,
      fields: removeEmptyFields(schemaFields)
    },
    editable_fields: policy.editableFields,
    ...(userInstruction.trim() ? { user_instruction: userInstruction.trim() } : {}),
    ...(jobDescription.trim() ? { job_description: jobDescription.trim() } : {})
  };
};

export const buildModuleBlockSuggestUserPrompt = (options: {
  actionType: AiSuggestionActionType;
  policy: ModuleBlockAiPolicy;
}): string => {
  const { actionType, policy } = options;
  const editableList = policy.editableFields.join(", ");

  return [
    `You are improving one "${policy.definition.title}" entry of a UK medical CV.`,
    `Apply the ${actionType} action to ONLY these field(s) of block.fields: ${editableList}.`,
    "Every other key in block.fields is a read-only fact (registration numbers, dates, grades, institutions, audit standards, scores).",
    "Use those facts as context to write truthful, specific content, but never alter, invent, or embellish facts, and never state facts that are not present in the input.",
    "Preserve any metrics or scores already inside the rewritten field verbatim.",
    'Return strict JSON {"suggested_block": {"fields": {<the editable fields only>}}}.',
    'Keep each field\'s shape: string fields stay a single string (bullet lines may use "• "), array fields stay arrays of short bullet strings.',
    "Do not return the read-only fields."
  ].join(" ");
};

// Hard anti-hallucination guardrail: returns a full block where ONLY the policy's
// editable fields may differ from currentBlock. id/type/order/visibility/meta and
// every fact field come from currentBlock unconditionally.
export const enforceModuleBlockAiPolicy = (options: {
  currentBlock: CvBlock;
  suggestedBlock: Record<string, unknown>;
  policy: ModuleBlockAiPolicy;
}): CvBlock => {
  const { currentBlock, suggestedBlock, policy } = options;

  // Models sometimes flatten the fields to the suggested_block top level.
  const candidateFields = isPlainRecord(suggestedBlock.fields) ? suggestedBlock.fields : suggestedBlock;

  const kindByKey = new Map(policy.definition.fieldSchema.map((field) => [field.key, field.kind]));
  const overrides: Record<string, CvJsonValue> = {};

  for (const key of policy.editableFields) {
    if (!(key in candidateFields)) {
      continue;
    }

    const kind = kindByKey.get(key);
    const coerced =
      kind === "bullets" ? toBulletArray(candidateFields[key]) : toNarrativeString(candidateFields[key]);
    if (coerced !== null) {
      overrides[key] = coerced;
    }
  }

  if (Object.keys(overrides).length === 0) {
    throw new AiFlowFailedError("AI response did not contain any editable field", {
      flow_type: "block_suggest",
      reason: "module_policy_editable_output_missing",
      editable_fields: policy.editableFields
    });
  }

  return {
    ...currentBlock,
    fields: normalizeCvJsonRecord({ ...currentBlock.fields, ...overrides })
  };
};

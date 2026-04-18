import { randomUUID } from "node:crypto";
import type { AiFlowType } from "../../../shared/types/domain";
import type { AiProvider, AiProviderRequest, AiProviderResult } from "./ai-provider";

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "you",
  "your",
  "from",
  "will",
  "have",
  "has",
  "our",
  "are",
  "about",
  "into",
  "using",
  "use",
  "within",
  "work",
  "team",
  "iş",
  "ve",
  "ile",
  "için",
  "gibi",
  "olan",
  "olarak",
  "daha",
  "çok",
  "bir",
  "biz",
  "sen",
  "şirket",
  "pozisyon",
  "role",
  "position"
]);

const asRecord = (value: unknown): Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const asArray = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : [];
};

const asString = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const capitalize = (value: string): string => {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
};

const tokenizeKeywords = (text: string, count: number): string[] => {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}+#/.:-]{3,}/gu) ?? []).filter(
    (word) => !STOP_WORDS.has(word)
  );

  const frequency = new Map<string, number>();
  for (const word of words) {
    frequency.set(word, (frequency.get(word) ?? 0) + 1);
  }

  return [...frequency.entries()]
    .sort((a, b) => {
      if (b[1] === a[1]) {
        return a[0].localeCompare(b[0]);
      }

      return b[1] - a[1];
    })
    .slice(0, count)
    .map(([word]) => word);
};

const splitSentences = (text: string, count: number): string[] => {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  return sentences.slice(0, count);
};

const clip = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3).trim()}...`;
};

const deepClone = <T>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

const extractPrimaryTextField = (block: Record<string, unknown>): { key: string; text: string } => {
  const fields = asRecord(block.fields);
  const priorityKeys = ["text", "summary", "description", "content", "headline"];

  for (const key of priorityKeys) {
    if (typeof fields[key] === "string") {
      return {
        key,
        text: String(fields[key])
      };
    }
  }

  const firstStringEntry = Object.entries(fields).find(([, value]) => typeof value === "string");
  if (firstStringEntry) {
    return {
      key: firstStringEntry[0],
      text: String(firstStringEntry[1])
    };
  }

  return {
    key: "text",
    text: ""
  };
};

const setPrimaryTextField = (
  block: Record<string, unknown>,
  key: string,
  nextText: string
): Record<string, unknown> => {
  const fields = {
    ...asRecord(block.fields),
    [key]: nextText
  };

  return {
    ...block,
    fields
  };
};

const toKeywordsText = (keywords: string[]): string => {
  if (keywords.length === 0) {
    return "";
  }

  return keywords.map((keyword) => capitalize(keyword)).join(", ");
};

const buildSuggestionText = (
  sourceText: string,
  actionType: string,
  keywords: string[],
  userInstruction: string,
  variantIndex = 0
): string => {
  const cleanSource = sourceText.trim();
  const cleanInstruction = userInstruction.trim();
  const keywordText = toKeywordsText(keywords.slice(0, 5));

  if (!cleanSource) {
    const starter = cleanInstruction || "Describe impact with measurable outcomes.";
    return clip(starter, 900);
  }

  if (actionType === "summarize" || actionType === "shorten") {
    const sentences = splitSentences(cleanSource, 2);
    const merged = sentences.join(" ") || cleanSource;
    return clip(merged, actionType === "shorten" ? 180 : 260);
  }

  if (actionType === "expand") {
    const extra =
      cleanInstruction ||
      "Added outcome-focused detail to clarify ownership, scope, and measurable business impact.";
    return clip(`${cleanSource} ${extra}`, 900);
  }

  if (actionType === "ats_optimize") {
    if (!keywordText) {
      return clip(cleanSource, 900);
    }

    return clip(`${cleanSource} Core keywords: ${keywordText}.`, 900);
  }

  if (actionType === "rewrite") {
    const suffix = cleanInstruction ? ` Focus: ${cleanInstruction}.` : "";
    return clip(`Rewritten: ${cleanSource}${suffix}`, 900);
  }

  if (actionType === "options") {
    const optionStyle = ["direct", "achievement-driven", "concise"];
    const style = optionStyle[variantIndex % optionStyle.length];
    const suffix = keywordText ? ` Keywords: ${keywordText}.` : "";
    return clip(`Option ${variantIndex + 1} (${style}): ${cleanSource}${suffix}`, 900);
  }

  const defaultSuffix = cleanInstruction ? ` ${cleanInstruction}` : "";
  return clip(`Improved: ${cleanSource}${defaultSuffix}`, 900);
};

const generateJobAnalysis = (input: Record<string, unknown>): Record<string, unknown> => {
  const jobDescription = asString(input.job_description);
  const masterText = asString(input.master_cv_text);
  const keywords = tokenizeKeywords(jobDescription, 12);
  const requirements = splitSentences(jobDescription, 6);
  const strengths = keywords
    .filter((keyword) => masterText.toLowerCase().includes(keyword))
    .slice(0, 6)
    .map((keyword) => `Evidence found for ${keyword}`);
  const gaps = keywords
    .filter((keyword) => !masterText.toLowerCase().includes(keyword))
    .slice(0, 6)
    .map((keyword) => `Add concrete evidence for ${keyword}`);
  const matchedCount = keywords.length === 0 ? 0 : keywords.length - gaps.length;
  const fitScore = keywords.length === 0 ? 50 : Math.max(25, Math.min(95, Math.round((matchedCount / keywords.length) * 100)));

  const summary = `Role fit is estimated at ${fitScore}%. Prioritize ${
    gaps.length > 0 ? gaps.slice(0, 3).join("; ") : "strong alignment and quantifiable achievements"
  }.`;

  return {
    keywords,
    requirements,
    strengths,
    gaps,
    summary,
    fit_score: fitScore
  };
};

const generateFollowUpQuestions = (input: Record<string, unknown>): Record<string, unknown> => {
  const jobDescription = asString(input.job_description);
  const keywords = tokenizeKeywords(jobDescription, 8);
  const gapKeywords = asArray(input.gap_keywords)
    .map((value) => asString(value))
    .filter(Boolean)
    .slice(0, 4);

  const focusKeywords = gapKeywords.length > 0 ? gapKeywords : keywords.slice(0, 4);

  const questions: Record<string, unknown>[] = [
    {
      id: `q-impact-${randomUUID()}`,
      question: "Which achievement best demonstrates your impact for this role?",
      question_type: "text",
      target_hint: "experience"
    },
    {
      id: `q-priority-${randomUUID()}`,
      question: "Which focus areas should be emphasized most in this tailored CV?",
      question_type: "multi_select",
      choices: focusKeywords.map((keyword) => ({
        id: keyword,
        label: capitalize(keyword)
      })),
      target_hint: "summary"
    },
    {
      id: `q-tone-${randomUUID()}`,
      question: "Which writing style should the tailored CV prioritize?",
      question_type: "single_choice",
      choices: [
        {
          id: "results_first",
          label: "Results-first"
        },
        {
          id: "technical_depth",
          label: "Technical depth"
        },
        {
          id: "leadership_focus",
          label: "Leadership focus"
        }
      ],
      target_hint: "summary"
    }
  ];

  for (const gapKeyword of focusKeywords.slice(0, 2)) {
    questions.push({
      id: `q-gap-${gapKeyword}-${randomUUID()}`,
      question: `Share one concrete example for ${capitalize(gapKeyword)} that should appear in the CV.`,
      question_type: "text",
      target_hint: "experience"
    });
  }

  return {
    questions
  };
};

const ensureTailoredContent = (
  maybeContent: Record<string, unknown>,
  language: string
): Record<string, unknown> => {
  const content = deepClone(maybeContent);

  if (!content.version) {
    content.version = "v1";
  }

  content.language = language || asString(content.language) || "en";
  content.metadata = {
    ...asRecord(content.metadata)
  };

  if (!Array.isArray(content.sections)) {
    content.sections = [];
  }

  return content;
};

const generateTailoredDraft = (input: Record<string, unknown>): Record<string, unknown> => {
  const masterContent = asRecord(input.master_content);
  const job = asRecord(input.job);
  const answers = asArray(input.answers).map((answer) => asRecord(answer));
  const jobTitle = asString(job.job_title);
  const companyName = asString(job.company_name);
  const language = asString(input.language) || asString(masterContent.language) || "en";
  const jobDescription = asString(job.job_description);
  const answerSummary = answers
    .map((answer) => asString(answer.answer_text).trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
  const keywords = tokenizeKeywords(jobDescription, 6);

  const content = ensureTailoredContent(masterContent, language);
  const metadata = asRecord(content.metadata);
  content.metadata = {
    ...metadata,
    target_job_title: jobTitle,
    target_company_name: companyName
  };

  const sections = asArray(content.sections).map((section) => asRecord(section));
  const changedBlockIds: string[] = [];

  let summaryUpdated = false;

  for (const section of sections) {
    const blocks = asArray(section.blocks).map((block) => asRecord(block));

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const blockType = asString(block.type);
      const blockId = asString(block.id);

      if (!summaryUpdated && (blockType === "summary" || asString(section.type) === "summary")) {
        const primary = extractPrimaryTextField(block);
        const sourceText = primary.text || "";
        const intro = `Targeting ${jobTitle || "the role"} at ${companyName || "the company"}.`;
        const keywordLine = keywords.length > 0 ? ` Key strengths: ${toKeywordsText(keywords)}.` : "";
        const answerLine = answerSummary ? ` Tailoring notes: ${clip(answerSummary, 260)}.` : "";
        const nextText = clip(`${intro} ${sourceText}${keywordLine}${answerLine}`.trim(), 1000);
        blocks[index] = setPrimaryTextField(block, primary.key, nextText);
        summaryUpdated = true;

        if (blockId) {
          changedBlockIds.push(blockId);
        }
      }

      if (asString(section.type) === "skills") {
        const fields = asRecord(block.fields);
        const existingSkills = asArray(fields.skills)
          .map((item) => asString(item).trim())
          .filter(Boolean);

        if (keywords.length > 0 && existingSkills.length > 0) {
          const mergedSkills = [...new Set([...existingSkills, ...keywords.map((keyword) => capitalize(keyword))])].slice(0, 24);
          blocks[index] = {
            ...block,
            fields: {
              ...fields,
              skills: mergedSkills
            }
          };

          if (blockId) {
            changedBlockIds.push(blockId);
          }
        }
      }
    }

    section.blocks = blocks;
  }

  content.sections = sections;

  return {
    current_content: content,
    generation_summary: `Generated tailored draft for ${jobTitle || "target role"} at ${companyName || "target company"}.`,
    changed_block_ids: [...new Set(changedBlockIds)]
  };
};

const generateBlockSuggestions = (
  input: Record<string, unknown>,
  fallbackCount = 1
): Record<string, unknown> => {
  const actionType = asString(input.action_type) || "improve";
  const optionCount =
    Number.isInteger(input.option_count) && Number(input.option_count) > 0
      ? Number(input.option_count)
      : fallbackCount;
  const block = asRecord(input.block);
  const userInstruction = asString(input.user_instruction);
  const jobDescription = asString(input.job_description);
  const keywords = tokenizeKeywords(jobDescription, 6);
  const primary = extractPrimaryTextField(block);

  const suggestions = Array.from({ length: optionCount }).map((_, index) => {
    const nextText = buildSuggestionText(primary.text, actionType, keywords, userInstruction, index);
    const suggestedBlock = setPrimaryTextField(block, primary.key, nextText);

    return {
      label: actionType === "options" ? `Option ${index + 1}` : capitalize(actionType.replace("_", " ")),
      rationale:
        actionType === "ats_optimize"
          ? "Added role-relevant keywords while preserving source context."
          : actionType === "shorten" || actionType === "summarize"
            ? "Condensed text while keeping core signal and impact language."
            : actionType === "expand"
              ? "Expanded context to make scope and impact clearer."
              : "Adjusted wording for stronger relevance and clarity.",
      suggested_block: {
        ...suggestedBlock,
        meta: {
          ...asRecord(suggestedBlock.meta),
          ai_action_type: actionType,
          ai_option_index: index
        }
      }
    };
  });

  return {
    suggestions
  };
};

const generateBlockCompare = (input: Record<string, unknown>): Record<string, unknown> => {
  const jobDescription = asString(input.job_description);
  const blockText = asString(input.block_text);
  const keywords = tokenizeKeywords(jobDescription, 10);
  const blockTextLower = blockText.toLowerCase();
  const matched = keywords.filter((keyword) => blockTextLower.includes(keyword));
  const missing = keywords.filter((keyword) => !blockTextLower.includes(keyword));

  const gapHighlights = missing.slice(0, 5).map((keyword) => `${capitalize(keyword)} is not clearly evidenced.`);
  const guidance = missing.slice(0, 5).map((keyword) => `Add one quantified example for ${capitalize(keyword)}.`);
  const summary = `This block aligns with ${matched.length}/${keywords.length || 1} priority keywords from the job description.`;

  return {
    comparison_summary: summary,
    gap_highlights: gapHighlights,
    improvement_guidance: guidance,
    matched_keywords: matched,
    missing_keywords: missing
  };
};

export class MockAiProvider implements AiProvider {
  readonly providerName = "mock";

  constructor(private readonly defaultModelName: string) {}

  resolveModelName(_flowType: AiFlowType): string {
    return this.defaultModelName;
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    let outputPayload: Record<string, unknown>;

    switch (request.flow_type) {
      case "job_analysis":
        outputPayload = generateJobAnalysis(request.input_payload);
        break;
      case "follow_up_questions":
        outputPayload = generateFollowUpQuestions(request.input_payload);
        break;
      case "tailored_draft":
        outputPayload = generateTailoredDraft(request.input_payload);
        break;
      case "block_suggest":
        outputPayload = generateBlockSuggestions(request.input_payload, 1);
        break;
      case "multi_option":
        outputPayload = generateBlockSuggestions(request.input_payload, 3);
        break;
      case "block_compare":
        outputPayload = generateBlockCompare(request.input_payload);
        break;
      case "summary":
      case "improve":
      default:
        outputPayload = generateBlockSuggestions(request.input_payload, 1);
        break;
    }

    return {
      provider: this.providerName,
      model_name: request.model_name,
      output_payload: outputPayload
    };
  }
}

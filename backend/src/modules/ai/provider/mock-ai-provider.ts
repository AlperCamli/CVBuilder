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

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "item";

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

  if (actionType === "summarize") {
    const sentences = splitSentences(cleanSource, 2);
    const merged = sentences.join(" ") || cleanSource;
    return clip(merged, 260);
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

  const defaultSuffix = cleanInstruction ? ` ${cleanInstruction}` : "";
  return clip(`Improved: ${cleanSource}${defaultSuffix}`, 900);
};

const generateJobAnalysis = (input: Record<string, unknown>): Record<string, unknown> => {
  const jobDescription = asString(input.job_description);
  const keywords = tokenizeKeywords(jobDescription, 12);
  const topics = splitSentences(jobDescription, 8).map((sentence) => clip(sentence, 160));

  return {
    topics: topics.length > 0 ? topics : keywords.slice(0, 6).map((keyword) => capitalize(keyword)),
    keywords
  };
};

const generateFollowUpQuestions = (input: Record<string, unknown>): Record<string, unknown> => {
  const topics = asArray(input.selected_topics)
    .map((value) => asString(value))
    .filter(Boolean)
    .slice(0, 3);
  const keywords = asArray(input.selected_keywords)
    .map((value) => asString(value))
    .filter(Boolean)
    .slice(0, 3);
  const focusItems = [...topics, ...keywords].slice(0, 4);

  const questions: Record<string, unknown>[] = [
    {
      id: `q-impact-${randomUUID()}`,
      question: "Which achievement should be emphasized most?",
      question_type: "short_text"
    },
    {
      id: `q-confirm-${randomUUID()}`,
      question: "Should the CV emphasize measurable outcomes where possible?",
      question_type: "yes_no"
    }
  ];

  for (const item of focusItems.slice(0, 2)) {
    questions.push({
      id: `q-${slugify(item)}-${randomUUID()}`,
      question: `How should ${item} be reflected in your CV?`,
      question_type: "short_text"
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
  const masterContent = asRecord(input.master_cv);
  const answers = asArray(input.answered_questions).map((answer) => asRecord(answer));
  const selectedKeywords = asArray(input.selected_keywords).map((item) => asString(item)).filter(Boolean);
  const jobTitle = asString(input.role);
  const language = asString(input.language) || asString(masterContent.language) || "en";
  const answerSummary = answers
    .map((answer) => asString(answer.answer).trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
  const keywords = selectedKeywords.length > 0 ? selectedKeywords.slice(0, 8) : tokenizeKeywords(JSON.stringify(masterContent), 6);

  const content = ensureTailoredContent(masterContent, language);

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
        const intro = `Targeting ${jobTitle || "the role"}.`;
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
    changed_block_ids: [...new Set(changedBlockIds)]
  };
};

const generateImportImprove = (input: Record<string, unknown>): Record<string, unknown> => {
  const cvBody = asRecord(input.cv_body);
  const content = ensureTailoredContent(cvBody, "en");
  const sections = asArray(content.sections).map((section) => asRecord(section));
  const changedBlockIds: string[] = [];

  for (const section of sections) {
    const blocks = asArray(section.blocks).map((block) => asRecord(block));

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      const primary = extractPrimaryTextField(block);
      const nextText = buildSuggestionText(primary.text, "improve", [], "", index);
      const updated = setPrimaryTextField(block, primary.key, nextText);
      blocks[index] = updated;

      const blockId = asString(updated.id);
      if (blockId) {
        changedBlockIds.push(blockId);
      }
    }

    section.blocks = blocks;
  }

  content.sections = sections;

  return {
    improved_content: content,
    changed_block_ids: [...new Set(changedBlockIds)]
  };
};

const generateProfessionalSummary = (input: Record<string, unknown>): Record<string, unknown> => {
  const cvBody = asRecord(input.cv_body);
  const sections = asArray(cvBody.sections).map((section) => asRecord(section));
  const sourceText = sections
    .flatMap((section) => asArray(section.blocks).map((block) => extractPrimaryTextField(asRecord(block)).text))
    .filter(Boolean)
    .join(" ");
  const summary = clip(sourceText, 260) || "Experienced professional with a practical background and clear strengths.";

  return {
    summary_text: `${summary}${summary.endsWith(".") ? "" : "."}`
  };
};

const generateCvParse = (input: Record<string, unknown>): Record<string, unknown> => {
  const rawText = asString(input.raw_text).trim();
  const language = asString(input.language_hint) || "en";
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const summaryText = clip(lines.slice(0, 4).join(" "), 1200) || "Imported CV content.";
  const keywordCandidates = tokenizeKeywords(rawText, 12).map((keyword) => capitalize(keyword));
  const skillValues = [...new Set(keywordCandidates)].slice(0, 12);

  return {
    parsed_content: {
      version: "v1",
      language,
      metadata: {},
      sections: [
        {
          id: `summary-${randomUUID()}`,
          type: "summary",
          title: "Summary",
          order: 1,
          blocks: [
            {
              id: `summary-block-${randomUUID()}`,
              type: "summary",
              order: 1,
              visibility: "visible",
              fields: {
                text: summaryText
              },
              meta: {}
            }
          ],
          meta: {}
        },
        {
          id: `skills-${randomUUID()}`,
          type: "skills",
          title: "Skills",
          order: 2,
          blocks: [
            {
              id: `skills-block-${randomUUID()}`,
              type: "skills",
              order: 1,
              visibility: "visible",
              fields: {
                items: skillValues,
                text: skillValues.join(", ")
              },
              meta: {}
            }
          ],
          meta: {}
        }
      ]
    },
    warnings: rawText ? [] : ["Input text was empty; returned minimal structured content."]
  };
};

const generateCoverLetter = (input: Record<string, unknown>): Record<string, unknown> => {
  const jobTitle = asString(input.job_title).trim() || "the role";
  const companyName = asString(input.company_name).trim() || "the company";
  const tone = asString(input.tone).trim() || "professional";
  const keywords = tokenizeKeywords(asString(input.job_description), 6)
    .map((keyword) => capitalize(keyword))
    .join(", ");

  const body = [
    `Dear Hiring Team,`,
    ``,
    `I am excited to apply for the ${jobTitle} position at ${companyName}.`,
    `My background aligns well with the role, and I can contribute quickly with a ${tone} approach focused on measurable outcomes.`,
    keywords
      ? `I would particularly bring value in areas such as ${keywords}.`
      : `I would bring strong execution, ownership, and collaboration to your team.`,
    `I would welcome the opportunity to discuss how I can support your priorities.`,
    ``,
    `Sincerely,`,
    `[Your Name]`
  ].join("\n");

  return {
    title: `${jobTitle} - ${companyName}`,
    content: body
  };
};

const generateBlockSuggestions = (
  input: Record<string, unknown>,
  _fallbackCount = 1
): Record<string, unknown> => {
  const actionType = asString(input.action_type) || "improve";
  const block = asRecord(input.block);
  const userInstruction = asString(input.user_instruction);
  const jobDescription = asString(input.job_description);
  const skillsPoolContext = asRecord(input.skills_pool_context);
  const keywords = tokenizeKeywords(jobDescription, 6);
  const primary = extractPrimaryTextField(block);

  if (Object.keys(skillsPoolContext).length > 0) {
    const existingSkills = asArray(skillsPoolContext.existing_skills)
      .map((item) => asString(item).trim())
      .filter(Boolean);
    const experienceDescriptions = asArray(skillsPoolContext.work_experience)
      .map((item) => asString(asRecord(item).description))
      .filter(Boolean)
      .join(" ");
    const educationDescriptions = asArray(skillsPoolContext.education)
      .flatMap((item) => {
        const row = asRecord(item);
        return [asString(row.degree), asString(row.field_of_study), asString(row.description)];
      })
      .filter(Boolean)
      .join(" ");
    const inferred = tokenizeKeywords(`${experienceDescriptions} ${educationDescriptions}`, 20).map((token) => capitalize(token));
    const mergedSkills = [...new Set([...existingSkills, ...inferred])].slice(0, 20);
    const suggestedBlock = {
      ...block,
      fields: {
        ...asRecord(block.fields),
        skills: mergedSkills
      }
    };

    return {
      suggested_block: suggestedBlock
    };
  }

  const nextText = buildSuggestionText(primary.text, actionType, keywords, userInstruction, 0);
  const suggestedBlock = setPrimaryTextField(block, primary.key, nextText);

  return {
    suggested_block: {
      ...suggestedBlock,
      meta: {
        ...asRecord(suggestedBlock.meta),
        ai_action_type: actionType
      }
    }
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
      case "import_improve":
        outputPayload = generateImportImprove(request.input_payload);
        break;
      case "professional_summary":
        outputPayload = generateProfessionalSummary(request.input_payload);
        break;
      case "cv_parse":
        outputPayload = generateCvParse(request.input_payload);
        break;
      case "cover_letter_generation":
        outputPayload = generateCoverLetter(request.input_payload);
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

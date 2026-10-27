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

// Fallback candidates for skills-pool suggestions once CV-derived keywords are exhausted,
// so repeated refreshes in dev keep surfacing skills the CV doesn't have yet.
const MOCK_SKILL_BANK = [
  "Communication",
  "Problem Solving",
  "Team Leadership",
  "Project Management",
  "Stakeholder Management",
  "Data Analysis",
  "Process Improvement",
  "Agile Methodologies",
  "Cross-functional Collaboration",
  "Strategic Planning",
  "Time Management",
  "Presentation Skills",
  "Mentoring",
  "Quality Assurance",
  "Documentation",
  "Negotiation",
  "Risk Management",
  "Customer Focus",
  "Critical Thinking",
  "Adaptability",
  "Budget Management",
  "Vendor Management",
  "Public Speaking",
  "Conflict Resolution"
];

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
  const companyName = asString(input.company_name).trim();
  const positionPhrase = companyName ? `${jobTitle} position at ${companyName}` : `${jobTitle} position`;
  const tone = asString(input.tone).trim() || "professional";
  const keywords = tokenizeKeywords(asString(input.job_description), 6)
    .map((keyword) => capitalize(keyword))
    .join(", ");

  const body = [
    `Dear Hiring Team,`,
    ``,
    `I am excited to apply for the ${positionPhrase}.`,
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
    title: companyName ? `${jobTitle} - ${companyName}` : jobTitle,
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
    const currentPool = asArray(skillsPoolContext.current_pool)
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
    const summaryText = asString(skillsPoolContext.summary);
    const inferred = tokenizeKeywords(
      `${summaryText} ${experienceDescriptions} ${educationDescriptions}`,
      40
    ).map((token) => capitalize(token));
    // Like the real providers are instructed to, return only skills the CV doesn't already
    // know about — never echo existing_skills or current_pool. The generic bank keeps dev
    // refreshes producing new suggestions after the CV-derived keywords run out.
    const knownSkills = new Set([...existingSkills, ...currentPool].map((item) => item.toLowerCase()));
    const freshSkills = [...new Set([...inferred, ...MOCK_SKILL_BANK])].filter(
      (skill) => !knownSkills.has(skill.toLowerCase())
    );
    const suggestedBlock = {
      ...block,
      fields: {
        ...asRecord(block.fields),
        skills: freshSkills.slice(0, 20)
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

// Deterministic tailoring v2 outputs: enough structure to exercise every panel step locally.
const mockRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const generateTailoringAnalysis = (input: Record<string, unknown>): Record<string, unknown> => {
  const job = mockRecord(input.job);
  const role = String(job.role ?? "the role");
  const blocks = (Array.isArray(input.cv) ? input.cv : []).map(mockRecord);
  const items = blocks.filter((block) => !["skills", "summary"].includes(String(block.section)) && block.text);
  const first = items[0];
  const second = items[1];
  const words = String(job.description ?? "")
    .split(/[^A-Za-z+#.]+/)
    .filter((word) => word.length > 4)
    .slice(0, 3);

  return {
    role_summary: `The ${role} role needs hands-on delivery and clear communication.`,
    requirements: [
      {
        id: "r1",
        text: `Relevant experience for ${role}`,
        keywords: words.slice(0, 2),
        importance: "must",
        weight: 3,
        status: first ? "covered" : "missing",
        confidence: "high",
        evidence_block_ids: first ? [String(first.id)] : [],
        reason: first ? "Your recent role shows this directly." : "No matching experience was found."
      },
      {
        id: "r2",
        text: "Measurable results",
        keywords: ["results"],
        importance: "must",
        weight: 2,
        status: "weak",
        confidence: "medium",
        evidence_block_ids: second ? [String(second.id)] : [],
        reason: "Results are mentioned without numbers."
      },
      {
        id: "r3",
        text: `Experience with ${words[2] ?? "stakeholder management"}`,
        keywords: [words[2] ?? "stakeholder management"],
        importance: "must",
        weight: 1,
        status: "missing",
        confidence: "medium",
        evidence_block_ids: [],
        reason: "Not mentioned in the CV."
      }
    ],
    // Follows the analysis limits: at most 3 gap questions (must-haves the CV does not show,
    // aimed at one block) and 2 number questions (one per relevant block). The open number
    // question ("q_open_metric") is added by code, not by the model.
    questions: first
      ? [
          {
            id: "q1",
            kind: "gap",
            text: `${first.subtitle ? `At ${String(first.subtitle)}, did` : "Did"} you work with ${words[2] ?? "stakeholder management"}?`,
            requirement_id: "r3",
            target_block_id: String(first.id)
          },
          {
            id: "q2",
            kind: "metric",
            text: `Roughly how many people or users did your work reach${first.subtitle ? ` at ${String(first.subtitle)}` : " in this role"}?`,
            requirement_id: "r2",
            target_block_id: String(first.id)
          }
        ]
      : [],
    block_briefs: items.slice(0, 3).map((block) => ({
      block_id: String(block.id),
      requirement_ids: ["r1", "r2"],
      focus: `Show impact relevant to ${role}.`,
      terms: words.slice(0, 2),
      avoid: ""
    }))
  };
};

const generateTailoringBlock = (input: Record<string, unknown>): Record<string, unknown> => {
  const block = mockRecord(input.block);
  const role = String(mockRecord(input.job).role ?? "the role");
  const facts = (Array.isArray(input.confirmed_facts) ? input.confirmed_facts : []).map(mockRecord);
  // "Refine with AI": the candidate's request and the preset change the output visibly.
  const request = typeof input.candidate_request === "string" ? input.candidate_request.trim() : "";
  const shorter = typeof input.refinement === "string" && /shorter/i.test(input.refinement);
  const refinedNote = request ? `Refined as you asked: "${request}".` : "";
  if (block.kind === "summary" || block.kind === "new_summary") {
    const base = `Professional focused on delivering results relevant to ${role}, with a track record of ownership and collaboration.`;
    return {
      changed: true,
      lines: [request ? `${base} Refined as requested.` : shorter ? `Professional focused on results for ${role}.` : base],
      rationale: refinedNote || `Aims the summary at the ${role} role.`,
      requirement_ids: ["r1"]
    };
  }

  const lines = String(block.current_text ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/^[\s•*-]+/, "").trim())
    .filter(Boolean)
    .slice(0, 5);
  // Every confirmed detail (e.g. a metric answer) becomes its own bullet, as the prompt asks.
  const factLines = [
    ...new Set(facts.map((fact) => (typeof fact.detail === "string" ? fact.detail.trim() : "")).filter(Boolean))
  ];
  if (lines.length === 0 && factLines.length === 0) {
    return { changed: false, lines: [], rationale: "", requirement_ids: [] };
  }
  const rewritten = lines.length > 0 ? [`${lines[0]} in support of ${role} goals${request ? ", refined as requested" : ""}`, ...lines.slice(1)] : [];
  return {
    changed: true,
    lines: [...(shorter ? rewritten.slice(0, 2) : rewritten), ...factLines],
    rationale: refinedNote || (factLines.length > 0 ? "Adds the figures you confirmed." : "Leads with the most job-relevant work."),
    requirement_ids: ["r1", "r2"]
  };
};

const generateTailoringSkills = (input: Record<string, unknown>): Record<string, unknown> => {
  const current = (Array.isArray(input.current_skills) ? input.current_skills : []).map(String);
  const allowed = (Array.isArray(input.allowed_new_skills) ? input.allowed_new_skills : []).map(String);
  const refining = typeof input.candidate_request === "string" || typeof input.refinement === "string";
  if (refining && allowed.length === 0) {
    // A refine without new terms reorders the current list so the change is visible.
    return {
      changed: current.length > 1,
      skills: [...current].reverse().map((skill) => ({ name: skill, allowed_skill: null })),
      rationale: "Reordered your skills as requested.",
      requirement_ids: ["r1"]
    };
  }
  return {
    changed: allowed.length > 0,
    skills: [
      ...allowed.slice(0, 3).map((skill) => ({ name: skill, allowed_skill: skill })),
      ...current.map((skill) => ({ name: skill, allowed_skill: null }))
    ],
    rationale: "Puts the skills this job asks for first.",
    requirement_ids: ["r1"]
  };
};

export class MockAiProvider implements AiProvider {
  readonly providerName = "mock";

  constructor(private readonly defaultModelName: string) {}

  resolveModelName(_flowType: AiFlowType): string {
    return this.defaultModelName;
  }

  async generate(request: AiProviderRequest): Promise<AiProviderResult> {
    if (request.flow_type === "cv_translate") {
      return { provider: this.providerName, model_name: request.model_name, output_payload: { translations: request.input_payload.texts } };
    }
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
      case "skills_pool":
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
      case "tailoring_analysis":
        outputPayload = generateTailoringAnalysis(request.input_payload);
        break;
      case "tailoring_block":
        outputPayload = generateTailoringBlock(request.input_payload);
        break;
      case "tailoring_skills":
        outputPayload = generateTailoringSkills(request.input_payload);
        break;
      case "tailoring_structure":
        outputPayload = {
          changed: false,
          section_order: (Array.isArray(request.input_payload.sections) ? request.input_payload.sections : [])
            .map((section) => String((section as Record<string, unknown>).id)),
          hide_section_ids: [],
          rationale: "The current section order already fits this role."
        };
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

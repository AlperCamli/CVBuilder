import type { CvContent, CvJsonValue, CvSection } from "../../shared/cv-content/cv-content.types";
import type { ParseCvFileDiagnostics } from "../imports/parsers/cv-parser";
import type { CvReviewAiOutput } from "../ai/flows/flow-contracts";
import { detectCvLanguage } from "../../shared/localization/languages";
import { CV_REVIEW_VERSION, type AiReviewCriterionId, type CvReview, type ReviewCheck, type ReviewDimension, type ReviewDimensionId, type ReviewImprovementDetail } from "./cv-review.types";

export const REVIEW_WEIGHTS = { impact: 25, wording: 20, depth: 15, focus: 15, skills_evidence: 10, structure: 10, ats: 5 } as const;
export const AI_REVIEW_CRITERIA: readonly AiReviewCriterionId[] = ["impact", "wording", "depth", "focus", "skills_evidence"];
// AI rating levels 0-4 map onto a concave curve, so full credit needs genuinely excellent evidence.
export const LEVEL_POINTS = [0, 35, 60, 80, 100] as const;
const LABELS: Record<ReviewDimensionId, string> = {
  impact: "Measurable results", wording: "Wording and clarity", depth: "Experience depth", focus: "Role focus",
  skills_evidence: "Skills backed by experience", structure: "Structure and completeness", ats: "Parseability / ATS compatibility"
};
const HEADER = new Set(["personal_info", "header", "contact", "contact_info"]);
export const EXPERIENCE = new Set(["experience", "work_experience", "employment", "clinical_experience", "projects", "volunteer", "audit_qi", "teaching", "management_leadership"]);
export const SKILLS = new Set(["skills", "clinical_skills", "additional_skills", "technical_skills"]);
const EDUCATION = new Set(["education", "medical_qualifications", "qualifications"]);
const NARRATIVE_KEYS = new Set(["description", "summary", "text", "content", "bullets", "achievements", "responsibilities", "highlights", "details", "outcomes", "duties", "evaluation"]);
const ACTION = /^(?:[•*\-–]\s*)?(?:achieved|administered|analysed|analyzed|automated|built|collaborated|coordinated|created|delivered|designed|developed|diagnosed|directed|drove|established|evaluated|implemented|improved|increased|launched|led|managed|mentored|optimized|organised|organized|provided|reduced|researched|resolved|supported|taught|trained|treated)\b/i;
const GENERIC = /\b(?:hard[- ]working|team player|results[- ]driven|go[- ]getter|think outside the box|responsible for|duties include)\b/i;
// Only narrative text is checked. Years and numeric dates are not results; any other figure that
// is not glued to letters (Q3, B2B) counts as measurable scope or outcome.
const DATES = /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{1,2}[./]\d{4}\b|\b(?:19|20)\d{2}\b/g;
export const hasMetric = (line: string): boolean => /(?<!\p{L})\d/u.test(line.replace(DATES, " "));
// Contact details are not needed to judge content and are not sent to the AI review.
const CONTACT = /[\w.+-]+@[\w.-]+\.[a-z]{2,}|https?:\/\/\S+|www\.\S+|\+?\d[\d ()-]{7,}\d/gi;
// Phone-like runs need 9+ digits, so date ranges such as "2019 - 2021" stay in headings.
const redact = (text: string): string => text.replace(CONTACT, match => /^[\d+]/.test(match) && match.replace(/\D/g, "").length < 9 ? match : "").replace(/\s+/g, " ").trim();
const MAX_AI_INPUT_CHARS = 14_000;

// Image-based PDFs: the file has no usable text layer (parser diagnostics.image_based), so an ATS
// cannot read it whatever its content. See cv-scoring.md, "Image-based CVs".
/** Highest total for an image-based CV whose content was recovered by OCR and scored. */
export const IMAGE_BASED_SCORE_CAP = 30;
/** Fixed total for an image-based CV with no usable text (OCR failed, timed out or disabled). */
export const IMAGE_BASED_NO_TEXT_SCORE = 10;
// Every sentence below is a key of the frontend review catalog (en.json / tr.json).
export const IMAGE_BASED_HEADLINE = "ATS systems can't read this CV because it is saved as an image";
export const IMAGE_BASED_IMPROVEMENT = "Rebuild your CV with selectable text instead of an image so applicant tracking systems can read it. Our editor creates an ATS-friendly CV in a few minutes.";
const IMAGE_BASED_OCR_NOTE = "We read your content with text recognition (OCR), but the score stays low until the file has selectable text.";
const IMAGE_BASED_NO_TEXT_NOTE = "We couldn't read any text in it, so your content was not assessed.";
const IMAGE_BASED_ATS_REASON = "Your CV is saved as an image without a usable text layer, so applicant tracking systems can't read it.";
const IMAGE_BASED_EVIDENCE = "No usable text layer: the PDF contains pictures of text.";
const IMAGE_BASED_NOT_ASSESSED = "Not assessed: we couldn't read text in this file.";
const IMAGE_BASED_ADD_CONTENT = "Add your experience, education and skills in the editor to get a full content score.";
const IMAGE_BASED_OCR_LIMITATION = "Content read with text recognition (OCR) does not show that an ATS can read the file.";

export const strings = (value: CvJsonValue | undefined): string[] => {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
};
export const flattenFields = (fields: Record<string, CvJsonValue>): string => Object.values(fields).flatMap(strings).join("\n");
export const normalize = (text: string): string => text.normalize("NFKC").toLowerCase().replace(/̇/g, "").replace(/\s+/g, " ").trim();
// Quote matching ignores case, spacing, bullets and quotation marks, nothing else.
export const looseText = (text: string): string => normalize(text).replace(/[“”"‘’'«»•*]/g, "").replace(/\s+/g, " ").trim();
const tokens = (text: string): string[] => normalize(text).match(/\.net\b|[\p{L}\p{N}][\p{L}\p{N}.]*(?:\+\+|#)?/gu) ?? [];
const wordCount = (text: string) => tokens(text).length;
const example = (text: string | undefined): string => text ? ` Example: “${text.slice(0, 160)}${text.length > 160 ? "…" : ""}”` : "";
const round = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const field = (section: CvSection, ...keys: string[]): boolean => section.blocks.some(block => keys.some(key => strings(block.fields[key]).length > 0));
const check = (id: string, label: string, ratio: number, max: number, evidence: string, suggestion: string): ReviewCheck => ({ id, label, points: Math.round(Math.max(0, Math.min(1, ratio)) * max * 100) / 100, max_points: max, evidence, suggestion });
const dimension = (id: ReviewDimensionId, checks: ReviewCheck[], reason: string | null = null): ReviewDimension => {
  const maximum = checks.reduce((sum, item) => sum + item.max_points, 0);
  return { id, label: LABELS[id], weight: REVIEW_WEIGHTS[id], score: !maximum ? null : round(100 * checks.reduce((sum, item) => sum + item.points, 0) / maximum), reason, checks };
};
/** A weakness without a quote or a separate fix: the whole text is the issue. */
const plainDetail = (text: string): ReviewImprovementDetail => ({ text, issue: text, quote: null, fix: null });
const plainDetails = (texts: string[]): ReviewImprovementDetail[] => texts.map(plainDetail);
const narrativeLines = (fields: Record<string, CvJsonValue>): string[] => Object.entries(fields).filter(([key]) => NARRATIVE_KEYS.has(key)).flatMap(([, value]) => strings(value)).flatMap(value => value.split(/\n+|(?:^|\s)[•]\s*/)).map(line => line.trim()).filter(Boolean);

export interface ReviewInput {
  content: CvContent | null;
  import_status?: string;
  raw_text?: string | null;
  diagnostics?: ParseCvFileDiagnostics | null;
}

export interface ContentAnalysis {
  content: CvContent;
  visibleSections: CvSection[];
  populated: CvSection[];
  text: string;
  narratives: string[];
  measurable: number;
}

/** A parsed upload whose PDF has no usable text layer. Older diagnostics never set the flag. */
const isImageBased = (input: ReviewInput): boolean =>
  input.diagnostics?.image_based === true && input.import_status !== undefined && !["failed", "uploaded", "parsing"].includes(input.import_status);
const ocrRecovered = (input: ReviewInput): boolean => isImageBased(input) && input.diagnostics?.ocr === "recovered";

// Usable OCR text of an image-based PDF is scored; its ATS problem is handled by the image-based rule.
const unsafeExtraction = (input: ReviewInput): boolean => {
  const diagnostics = input.diagnostics;
  return !ocrRecovered(input) && Boolean(diagnostics && (diagnostics.quality.low_confidence || diagnostics.quality.confidence === "low" || ["utf8_decode", "pdf_token_heuristic", "pdf_ocr_tesseract"].includes(diagnostics.final_stage)));
};

export const analyze = (input: ReviewInput): ContentAnalysis | null => {
  const isImport = input.import_status !== undefined;
  const visibleSections = (input.content?.sections ?? []).map(section => ({ ...section, blocks: section.blocks.filter(block => block.visibility !== "hidden") }));
  const populated = visibleSections.filter(section => section.blocks.some(block => flattenFields(block.fields).trim()));
  const text = populated.flatMap(section => section.blocks.map(block => flattenFields(block.fields))).join("\n");
  const unscorable = !input.content || wordCount(text) < 10 || unsafeExtraction(input) || (isImport && ["failed", "uploaded", "parsing"].includes(input.import_status!)) || (isImport && (!input.raw_text?.trim() || wordCount(input.raw_text) < 10));
  if (unscorable) return null;
  const narratives = [...new Set(populated.filter(s => EXPERIENCE.has(s.type)).flatMap(s => s.blocks.flatMap(b => narrativeLines(b.fields))))];
  return { content: input.content!, visibleSections, populated, text, narratives, measurable: narratives.filter(hasMetric).length };
};

const LIMITATIONS = ["This is our CV review rubric, not an employer's ATS score or a hiring prediction.", "Visual layout, columns, fonts, headers and exported file compatibility are not verified by this text review."];

const unscorableReview = (input: ReviewInput): CvReview => {
  const isImport = input.import_status !== undefined;
  const improvements = isImport ? ["Upload a text-based PDF or DOCX with selectable text and clear section headings.", "Review any recovered content in the editor and check it against the original CV before using it."] : ["Add your contact details, education and experience or projects before requesting a review."];
  return {
    version: CV_REVIEW_VERSION, method: "basic", status: "unscorable", score: null, assessed_weight: 0,
    summary: isImport
      ? "We could not reliably read this CV. This may indicate an ATS compatibility issue, or a problem with our parser. No score has been generated."
      : "There is not enough readable CV content to produce a reliable score.",
    dimensions: (Object.keys(REVIEW_WEIGHTS) as ReviewDimensionId[]).map(id => dimension(id, [], "Reliable readable content is required before evaluation.")),
    strengths: [],
    improvements,
    improvement_details: plainDetails(improvements),
    matched_keywords: [], missing_keywords: [], limitations: LIMITATIONS
  };
};

const imageBasedAtsDimension = (): ReviewDimension =>
  dimension("ats", [check("text_layer", "Readable text layer", 0, 100, IMAGE_BASED_EVIDENCE, IMAGE_BASED_IMPROVEMENT)], IMAGE_BASED_ATS_REASON);

/** Image-based, no usable text: a fixed low score, the ATS dimension at 0 and nothing else assessed. */
const imageBasedNoTextReview = (): CvReview => ({
  version: CV_REVIEW_VERSION, method: "basic", status: "partial", score: IMAGE_BASED_NO_TEXT_SCORE, assessed_weight: REVIEW_WEIGHTS.ats,
  summary: `${IMAGE_BASED_HEADLINE}. ${IMAGE_BASED_NO_TEXT_NOTE}`,
  dimensions: (Object.keys(REVIEW_WEIGHTS) as ReviewDimensionId[]).map(id => id === "ats" ? imageBasedAtsDimension() : dimension(id, [], IMAGE_BASED_NOT_ASSESSED)),
  strengths: [],
  improvements: [IMAGE_BASED_IMPROVEMENT, IMAGE_BASED_ADD_CONTENT],
  improvement_details: plainDetails([IMAGE_BASED_IMPROVEMENT, IMAGE_BASED_ADD_CONTENT]),
  matched_keywords: [], missing_keywords: [], limitations: LIMITATIONS,
  ats_blocker: "image_based"
});

/** Image-based, content recovered by OCR: the content review stands, capped, with the ATS problem first. */
const withImageBasedBlocker = (review: CvReview): CvReview => {
  const score = Math.min(review.score ?? 0, IMAGE_BASED_SCORE_CAP);
  const scope = review.summary.startsWith(`${band(review.score ?? 0)}. `) ? review.summary.slice(band(review.score ?? 0).length + 2) : "";
  return {
    ...review,
    score,
    summary: [`${IMAGE_BASED_HEADLINE}.`, IMAGE_BASED_OCR_NOTE, `${band(score)}.`, scope].filter(Boolean).join(" "),
    improvements: [IMAGE_BASED_IMPROVEMENT, ...review.improvements.filter(text => text !== IMAGE_BASED_IMPROVEMENT)].slice(0, 6),
    improvement_details: [plainDetail(IMAGE_BASED_IMPROVEMENT), ...(review.improvement_details ?? plainDetails(review.improvements)).filter(item => item.text !== IMAGE_BASED_IMPROVEMENT)].slice(0, 6),
    limitations: [...review.limitations, IMAGE_BASED_OCR_LIMITATION],
    ats_blocker: "image_based"
  };
};

const atsDimension = (input: ReviewInput): ReviewDimension => {
  if (isImageBased(input)) return imageBasedAtsDimension();
  const diagnostics = input.diagnostics;
  const isImport = input.import_status !== undefined;
  if (!diagnostics || !isImport) return dimension("ats", [], isImport ? "Extraction diagnostics are unavailable for this older upload. Re-upload to assess parseability." : "No uploaded or exported file was tested. Parseability is not assessed.");
  const primary = ["pdfjs_text", "docx_xml_text", "text_decode"].includes(diagnostics.final_stage);
  return dimension("ats", [
    check("extraction", "Text extraction quality", diagnostics.quality.score / 100, 60, `${diagnostics.quality.confidence} extraction confidence (${diagnostics.quality.score}/100).`, "Check the extracted content against the original document."),
    check("text_layer", "Readable text layer", primary ? 1 : 0, 40, primary ? "Text was extracted directly from the file." : "The file required fallback extraction.", "Export a document with selectable text rather than a scanned image.")
  ]);
};

export const structureDimension = ({ content, populated, visibleSections, text }: ContentAnalysis): ReviewDimension => {
  const contactText = [...populated.filter(s => HEADER.has(s.type)).flatMap(s => s.blocks.map(b => flattenFields(b.fields))), ...Object.entries(content.metadata).filter(([key]) => ["name", "full_name", "email", "phone"].includes(key)).flatMap(([, value]) => strings(value))].join("\n");
  const hasName = populated.some(s => HEADER.has(s.type) && field(s, "name", "full_name", "first_name")) || Boolean(strings(content.metadata.full_name ?? content.metadata.name).length);
  const hasContact = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(contactText) || /\+?\d[\d ()-]{7,}\d/.test(contactText);
  const has = (types: Set<string>) => populated.some(s => types.has(s.type));
  const emptySections = visibleSections.filter(s => s.blocks.length > 0 && !populated.includes(s)).length;
  const emptyBlocks = visibleSections.flatMap(s => s.blocks).filter(b => !flattenFields(b.fields).trim()).length;
  const titles = populated.map(s => normalize(s.title ?? s.type.replace(/_/g, " ")));
  const corruptText = /�|\x00/.test(text);
  return dimension("structure", [
    check("identity", "Name and contact details", (Number(hasName) + Number(hasContact)) / 2, 25, `${hasName ? "Name found" : "Name missing"}; ${hasContact ? "contact method found" : "email or phone missing"}.`, "Include your name and a reachable email or phone number."),
    check("experience", "Experience or projects", Number(has(EXPERIENCE)), 25, has(EXPERIENCE) ? "Populated experience or project content found." : "No populated experience or project section found.", "Add work, clinical, volunteer experience or projects with specific contributions."),
    check("education", "Education or qualifications", Number(has(EDUCATION)), 15, has(EDUCATION) ? "Education or qualifications found." : "No populated education or qualifications found.", "Include your education or relevant professional qualifications."),
    check("skills", "Skills", Number(has(SKILLS)), 15, has(SKILLS) ? "Populated skills section found." : "No populated skills section found.", "Add a focused skills section using skills you can substantiate."),
    check("headings", "Distinct section headings", Number(new Set(titles).size === titles.length), 10, `${titles.length} populated sections; ${titles.length - new Set(titles).size} duplicate headings.`, "Use distinct, descriptive section headings."),
    check("empty", "No empty content placeholders", Number(emptySections === 0 && emptyBlocks === 0), 5, `${emptySections} empty sections and ${emptyBlocks} empty visible blocks.`, "Remove empty placeholders or complete their content."),
    check("characters", "No detected broken text characters", Number(!corruptText), 5, corruptText ? "Broken replacement or null characters detected." : "No replacement or null characters detected in parsed text.", "Fix broken characters and verify the source file's text encoding.")
  ]);
};

const metricsEvidence = ({ narratives, measurable }: ContentAnalysis) => `${measurable}/${narratives.length} unique experience statements include measurable scope or results; full credit at 50%.${example(narratives.find(hasMetric))}`;

export const band = (score: number): string => score >= 85 ? "Strong, competitive CV" : score >= 70 ? "Good foundation, not yet competitive" : score >= 50 ? "Several areas need attention" : "Needs significant work";

/** A weakness candidate; `detail` holds its parts when they differ from "the text is the issue". */
interface ImprovementCandidate { priority: number; text: string; detail?: Omit<ReviewImprovementDetail, "text"> }

const assemble = (method: CvReview["method"], dimensions: ReviewDimension[], strengths: string[], improvements: ImprovementCandidate[], limitations: string[]): CvReview => {
  const assessed = dimensions.filter(d => d.score !== null);
  const weight = assessed.reduce((sum, d) => sum + d.weight, 0);
  const score = round(assessed.reduce((sum, d) => sum + d.weight * d.score!, 0) / weight);
  const status = weight === 100 ? "complete" : "partial";
  const scope = method === "basic"
    ? "This basic review covers only the dimensions we could check without the AI review."
    : status === "partial" ? "This score covers only the dimensions we could assess." : "All seven review dimensions were assessed.";
  const sorted = improvements.filter(item => item.priority > 0 && item.text).sort((a, b) => b.priority - a.priority);
  const ordered = [...new Set(sorted.map(item => item.text))];
  // Details follow the same order, dedupe (first candidate per text) and cap as `improvements`.
  const details = ordered.slice(0, 6).map(text => {
    const detail = sorted.find(item => item.text === text)!.detail;
    return detail ? { text, ...detail } : plainDetail(text);
  });
  return { version: CV_REVIEW_VERSION, method, status, score, assessed_weight: weight, summary: `${band(score)}. ${scope}`, dimensions, strengths: strengths.slice(0, 6), improvements: ordered.slice(0, 6), improvement_details: details, matched_keywords: [], missing_keywords: [], limitations: [...LIMITATIONS, ...limitations] };
};

const checkImprovements = (dimensions: ReviewDimension[]): ImprovementCandidate[] => dimensions.filter(d => d.score !== null).flatMap(d => d.checks.filter(c => c.points < c.max_points).map(c => ({ priority: d.weight * (1 - c.points / c.max_points), text: c.suggestion })));
const checkStrengths = (dimensions: ReviewDimension[]) => dimensions.filter(d => d.score !== null).flatMap(d => d.checks.filter(c => c.points === c.max_points).map(c => `${c.label}: ${c.evidence}`));

/**
 * Deterministic review used when the AI review is not permitted, unavailable or failed, and for
 * content edited after the upload. It withholds the content criteria it cannot judge.
 */
export function reviewCv(input: ReviewInput): CvReview {
  const analysis = analyze(input);
  if (isImageBased(input) && (!analysis || !ocrRecovered(input))) return imageBasedNoTextReview();
  if (!analysis) return unscorableReview(input);
  const { narratives } = analysis;
  const clear = narratives.filter(line => wordCount(line) >= 6 && wordCount(line) <= 45).length;
  const ratio = (count: number) => narratives.length ? count / narratives.length : 0;
  const english = /^en(?:-|$)/i.test(analysis.content.language);
  const concise = check("concise", "Clear, concise experience statements", ratio(clear), 40, `${clear}/${narratives.length} unique statements contain 6–45 words.${example(narratives.find(line => wordCount(line) < 6 || wordCount(line) > 45))}`, "Write concise experience statements with a specific action and context.");
  const wordingChecks = english ? [
    concise,
    check("action", "Statements beginning with an action", ratio(narratives.filter(line => ACTION.test(line)).length), 30, `${narratives.filter(line => ACTION.test(line)).length}/${narratives.length} unique statements begin with a recognized action verb.${example(narratives.find(line => !ACTION.test(line)) ?? narratives[0])}`, "Begin experience statements with concrete verbs such as built, delivered, managed or treated."),
    check("specific", "Wording without generic phrases", ratio(narratives.filter(line => !GENERIC.test(line)).length), 30, `${narratives.filter(line => !GENERIC.test(line)).length}/${narratives.length} statements avoid the checked generic phrases.${example(narratives.find(line => GENERIC.test(line)))}`, "Replace phrases such as 'responsible for' or 'team player' with specific examples.")
  ] : [concise];
  const aiOnly = "This criterion is assessed by the AI review, which was not available for this CV.";
  const dimensions = [
    dimension("impact", [check("metrics", "Statements with measurable scope or results", Math.min(1, ratio(analysis.measurable) / 0.5), 100, metricsEvidence(analysis), "Where relevant, quantify outcomes or scope (patients, users, time or cost). Keep every figure factual.")]),
    dimension("wording", wordingChecks, english ? null : "Only statement length is checked for this language without the AI review."),
    dimension("depth", [], aiOnly),
    dimension("focus", [], aiOnly),
    dimension("skills_evidence", [], aiOnly),
    structureDimension(analysis),
    atsDimension(input)
  ];
  const review = assemble("basic", dimensions, checkStrengths(dimensions), checkImprovements(dimensions), ["Without the AI review, experience depth, role focus and skills evidence are not assessed."]);
  return isImageBased(input) ? withImageBasedBlocker(review) : review;
}

export interface CvReviewSectionsAiInput {
  language: string;
  headline: string | null;
  stats: { experience_statements: number; statements_with_numbers: number };
  sections: Array<{ type: string; title: string; blocks: Array<{ id: string; heading: string; lines: string[] }> }>;
}
/** The extracted text of an upload, so the review can run alongside the AI parse. */
export interface CvReviewTextAiInput {
  language: string;
  text: string;
}
export type CvReviewAiInput = CvReviewSectionsAiInput | CvReviewTextAiInput;

// Line by line, so the layout the AI reads keeps its line breaks.
const redactLines = (rawText: string): string[] => rawText.split(/\r?\n/).map(redact).filter(Boolean);

/**
 * Null when the extracted text cannot be scored: no AI review is requested for it. Needs no parsed
 * content; scoreAiReview still applies the checks that do once the parse is back.
 */
export function buildRawReviewInput(rawText: string | null | undefined, diagnostics: ParseCvFileDiagnostics | null | undefined): CvReviewTextAiInput | null {
  const input: ReviewInput = { content: null, import_status: "parsed", raw_text: rawText, diagnostics };
  if (!rawText || wordCount(rawText) < 10 || unsafeExtraction(input) || (isImageBased(input) && !ocrRecovered(input))) return null;
  let text = "";
  for (const line of redactLines(rawText)) {
    if (text.length + line.length + 1 > MAX_AI_INPUT_CHARS) break;
    text += (text ? "\n" : "") + line;
  }
  return { language: detectCvLanguage(rawText) ?? "en", text };
}

/** Null when the content cannot be scored: no AI review is requested for it. */
export function buildAiReviewInput(input: ReviewInput): CvReviewSectionsAiInput | null {
  const analysis = analyze(input);
  if (!analysis || (isImageBased(input) && !ocrRecovered(input))) return null;
  let budget = MAX_AI_INPUT_CHARS;
  const take = (text: string, max: number) => {
    const value = redact(text).slice(0, Math.min(max, Math.max(0, budget)));
    budget -= value.length;
    return value;
  };
  let blockNumber = 0;
  const sections = analysis.populated.filter(section => !HEADER.has(section.type)).map(section => ({
    type: section.type,
    title: take(section.title ?? section.type.replace(/_/g, " "), 80),
    blocks: section.blocks.map(block => {
      const narrative = narrativeLines(block.fields);
      const labelled = Object.entries(block.fields).filter(([key]) => !NARRATIVE_KEYS.has(key)).flatMap(([, value]) => strings(value));
      // Short labelled fields (role, employer, dates) form the heading; skills keep every item as a line.
      const short = SKILLS.has(section.type) ? [] : labelled.filter(value => value.length <= 120);
      const lines = SKILLS.has(section.type) ? [...labelled, ...narrative] : [...narrative, ...labelled.filter(value => value.length > 120)];
      return { id: `b${++blockNumber}`, heading: take(short.join(" | "), 240), lines: lines.map(line => take(line, 300)).filter(Boolean) };
    }).filter(block => block.heading || block.lines.length)
  })).filter(section => section.blocks.length);
  return { language: analysis.content.language, headline: headline(analysis), stats: { experience_statements: analysis.narratives.length, statements_with_numbers: analysis.measurable }, sections };
}

// The stated target title lives in the header, which is otherwise left out with the contact details.
const HEADLINE_KEYS = ["headline", "title", "job_title", "professional_title"];
const headline = ({ content, populated }: ContentAnalysis): string | null => {
  const fromHeader = populated.filter(s => HEADER.has(s.type)).flatMap(s => s.blocks.flatMap(b => HEADLINE_KEYS.flatMap(key => strings(b.fields[key]))));
  const value = redact([...fromHeader, ...strings(content.metadata.headline)][0] ?? "").slice(0, 120);
  return value || null;
};

// The AI cannot rate impact above what the statements' figures support.
export const impactCap = ({ narratives, measurable }: ContentAnalysis): { level: number; reason: string | null } => {
  if (!narratives.length) return { level: 1, reason: "Capped at level 1: no experience statements were found." };
  if (!measurable) return { level: 2, reason: "Capped at level 2: no experience statement includes a number, amount or count." };
  if (measurable / narratives.length < 0.25) return { level: 3, reason: "Capped at level 3: fewer than a quarter of experience statements include a number, amount or count." };
  return { level: 4, reason: null };
};

/** Turns validated AI ratings into the v2 review. Throws when a criterion is missing so callers fall back. */
export function scoreAiReview(input: ReviewInput, output: CvReviewAiOutput): CvReview {
  const analysis = analyze(input);
  const aiInput = buildAiReviewInput(input);
  if (!analysis || !aiInput) return isImageBased(input) ? imageBasedNoTextReview() : unscorableReview(input);
  const byId = new Map(output.criteria.map(criterion => [criterion.id, criterion]));
  if (AI_REVIEW_CRITERIA.some(id => !byId.has(id))) throw new Error("AI review is missing a criterion");
  // The review may have read the parsed sections or the extracted text, so a quote may come from either.
  const rawText = input.raw_text ?? "";
  const corpus = looseText([...aiInput.sections.flatMap(section => [section.title, ...section.blocks.flatMap(block => [block.heading, ...block.lines])]), rawText, ...redactLines(rawText)].join("\n"));
  // A quote is shown only when it is really in the CV; fabricated excerpts are dropped.
  const verified = (quote: string | null) => {
    const loose = quote ? looseText(quote) : "";
    return loose.length >= 8 && corpus.includes(loose) ? quote!.trim() : null;
  };
  const cap = impactCap(analysis);
  const strengths: string[] = [];
  const improvements: ImprovementCandidate[] = [];
  const aiDimensions = AI_REVIEW_CRITERIA.map(id => {
    const criterion = byId.get(id)!;
    // Level 4 means no gap could be named: a rating that still names an issue counts as level 3.
    const rated = criterion.level === 4 && criterion.issue ? 3 : criterion.level;
    const capped = id === "impact" && rated > cap.level;
    const level = capped ? cap.level : rated;
    const points = LEVEL_POINTS[level];
    const quote = verified(criterion.quote);
    const issue = level < 4 ? criterion.issue : null;
    const fix = level < 4 ? criterion.fix : null;
    if (level >= 3 && criterion.strength) strengths.push(`${LABELS[id]}: ${criterion.strength}`);
    if (issue || fix) improvements.push({
      priority: REVIEW_WEIGHTS[id] * (100 - points) / 100,
      // Brief issues often come without a full stop; the quote or fix must not run on from them.
      text: [issue && (quote || fix) && !/[.!?…:]$/.test(issue) ? `${issue}.` : issue, quote ? `“${quote}”` : null, fix].filter(Boolean).join(" "),
      // Without an issue the fix is the lead line, so there is no separate fix box.
      detail: issue ? { issue, quote, fix } : { issue: fix!, quote, fix: null }
    });
    return dimension(id, [{
      id, label: LABELS[id], points, max_points: 100,
      evidence: [criterion.assessment, quote ? `“${quote}”` : null].filter(Boolean).join(" "),
      suggestion: fix ?? ""
    }], capped ? cap.reason : null);
  });
  const deterministic = [structureDimension(analysis), atsDimension(input)];
  const dimensions = [...aiDimensions, ...deterministic];
  const review = assemble("ai", dimensions, [...strengths, ...checkStrengths(deterministic)], [...improvements, ...checkImprovements(deterministic)], ["Content criteria are rated by an AI review against a fixed rubric; quoted examples are checked against your CV text."]);
  return isImageBased(input) ? withImageBasedBlocker(review) : review;
}

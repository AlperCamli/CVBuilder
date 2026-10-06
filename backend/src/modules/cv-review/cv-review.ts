import type { CvContent, CvJsonValue, CvSection } from "../../shared/cv-content/cv-content.types";
import type { ParseCvFileDiagnostics } from "../imports/parsers/cv-parser";
import type { CvReview, ReviewCheck, ReviewDimension, ReviewDimensionId, TailoringReview } from "./cv-review.types";

export const REVIEW_WEIGHTS = { ats: 20, sections: 15, relevance: 20, keywords: 15, quality: 15, impact: 10, formatting: 5 } as const;
const LABELS: Record<ReviewDimensionId, string> = {
  ats: "Parseability / ATS compatibility", sections: "Section completeness", relevance: "Job-description relevance",
  keywords: "Keyword coverage", quality: "Content quality", impact: "Measurable achievements", formatting: "Text structure and formatting"
};
const EXPERIENCE = new Set(["experience", "work_experience", "employment", "clinical_experience", "projects", "volunteer", "audit_qi", "teaching", "management_leadership"]);
const SKILLS = new Set(["skills", "clinical_skills", "additional_skills", "technical_skills"]);
const EDUCATION = new Set(["education", "medical_qualifications", "qualifications"]);
const NARRATIVE_KEYS = new Set(["description", "summary", "text", "content", "bullets", "achievements", "responsibilities", "highlights", "details", "outcomes", "duties", "evaluation"]);
const ACTION = /^(?:[•*\-–]\s*)?(?:achieved|administered|analysed|analyzed|automated|built|collaborated|coordinated|created|delivered|designed|developed|diagnosed|directed|drove|established|evaluated|implemented|improved|increased|launched|led|managed|mentored|optimized|organised|organized|provided|reduced|researched|resolved|supported|taught|trained|treated)\b/i;
const GENERIC = /\b(?:hard[- ]working|team player|results[- ]driven|go[- ]getter|think outside the box|responsible for|duties include)\b/i;
// Only narrative text is checked, so employment dates, telephone numbers and degrees do not count as impact.
const METRIC = /(?:\b\d+(?:[.,]\d+)?\s*(?:%|percent\b|patients?\b|users?\b|customers?\b|clients?\b|projects?\b|hours?\b|days?\b|weeks?\b|people\b|staff\b|members?\b|students?\b|teams?\b|reports?\b|audits?\b|procedures?\b|cases?\b|million\b|billion\b)|[$€£]\s*\d+(?:[.,]\d+)?)/i;
const STOP_WORDS = new Set(`a an and are as at be been being by can could do for from had has have if in into is it its of on or our that the their these they this those to was were will with you your we us about all also any both each more most other some such than then there through very which who work working job role candidate candidates company team teams opportunity opportunities responsibilities requirements required preferred looking seek seeking join excellent strong good ability skills experience knowledge years year including include ideally using use successful relevant demonstrate demonstrated must should new position qualifications qualification description benefits salary apply application employment employer equal workplace full time part based responsible duties support looking able minimum degree bachelor masters university equivalent passion committed commitment understanding ensure ensuring within across well day location people build built building create created creating design designed designing implement implemented implementing deliver delivered delivering maintain maintained maintaining manage managed managing improve improved improving communication written verbal proficient proficiency technical development develop professional`.split(/\s+/));

const strings = (value: CvJsonValue | undefined): string[] => {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (typeof value === "number") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
};
const flattenFields = (fields: Record<string, CvJsonValue>): string => Object.values(fields).flatMap(strings).join("\n");
const normalize = (text: string): string => text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const tokens = (text: string): string[] => normalize(text).match(/\.net\b|[\p{L}\p{N}][\p{L}\p{N}.]*(?:\+\+|#)?/gu) ?? [];
const wordCount = (text: string) => tokens(text).length;
const example = (text: string | undefined): string => text ? ` Example: “${text.slice(0, 160)}${text.length > 160 ? "…" : ""}”` : "";
const round = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const field = (section: CvSection, ...keys: string[]): boolean => section.blocks.some(block => keys.some(key => strings(block.fields[key]).length > 0));
const contains = (text: string, term: string): boolean => {
  const escaped = normalize(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^\\p{L}\\p{N}+#.])${escaped}(?=$|[^\\p{L}\\p{N}+#])`, "u").test(normalize(text));
};

/** A transparent lexical baseline, not an inference about a candidate's qualifications. */
export const extractJobKeywords = (description: string): string[] => {
  const counts = new Map<string, number>();
  for (const token of tokens(description.slice(0, 40_000))) {
    const term = token.replace(/\.$/, "");
    if ((term.length < 3 && !["r", "c", "c#"].includes(term)) || /^\d/.test(term) || STOP_WORDS.has(term)) continue;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en")).slice(0, 30).map(([term]) => term);
};

export interface ReviewInput {
  content: CvContent | null;
  import_status?: string;
  raw_text?: string | null;
  diagnostics?: ParseCvFileDiagnostics | null;
  job?: { job_title: string; job_description: string };
  /** Keywords from the existing AI job analysis / user's tailoring priorities. */
  keywords?: string[];
}

export function reviewCv(input: ReviewInput): CvReview {
  const diagnostics = input.diagnostics;
  const isImport = input.import_status !== undefined;
  const unsafeExtraction = Boolean(diagnostics && (diagnostics.quality.low_confidence || diagnostics.quality.confidence === "low" || ["utf8_decode", "pdf_token_heuristic", "pdf_ocr_tesseract"].includes(diagnostics.final_stage)));
  const visibleSections = (input.content?.sections ?? []).map(section => ({ ...section, blocks: section.blocks.filter(block => block.visibility !== "hidden") }));
  const populated = visibleSections.filter(section => section.blocks.some(block => flattenFields(block.fields).trim()));
  const text = populated.flatMap(section => section.blocks.map(block => flattenFields(block.fields))).join("\n");
  const emptyContent = wordCount(text) < 10;
  const unscorable = !input.content || emptyContent || unsafeExtraction || (isImport && ["failed", "uploaded", "parsing"].includes(input.import_status!)) || (isImport && (!input.raw_text?.trim() || wordCount(input.raw_text) < 10));
  const dimensions: ReviewDimension[] = [];
  const add = (id: ReviewDimensionId, checks: ReviewCheck[], reason: string | null = null) => {
    const maximum = checks.reduce((sum, check) => sum + check.max_points, 0);
    dimensions.push({ id, label: LABELS[id], weight: REVIEW_WEIGHTS[id], score: reason || !maximum ? null : round(100 * checks.reduce((sum, check) => sum + check.points, 0) / maximum), reason, checks });
  };
  const check = (id: string, label: string, ratio: number, max: number, evidence: string, suggestion: string): ReviewCheck => ({ id, label, points: Math.round(Math.max(0, Math.min(1, ratio)) * max * 100) / 100, max_points: max, evidence, suggestion });
  const limitations = ["This is our CV review rubric, not an employer's ATS score or a hiring prediction.", "Visual layout, columns, fonts, headers and exported file compatibility are not verified by this text review."];

  if (unscorable) {
    const summary = isImport
      ? "We could not reliably read this CV. This may indicate an ATS compatibility issue, or a problem with our parser. No score has been generated."
      : "There is not enough readable CV content to produce a reliable score.";
    for (const id of Object.keys(REVIEW_WEIGHTS) as ReviewDimensionId[]) add(id, [], "Reliable readable content is required before evaluation.");
    return { version: "cv-review-v1", status: "unscorable", score: null, assessed_weight: 0, summary, dimensions, strengths: [], improvements: isImport ? ["Upload a text-based PDF or DOCX with selectable text and clear section headings.", "Review any recovered content in the editor and check it against the original CV before using it."] : ["Add your contact details, education and experience or projects before requesting a review."], matched_keywords: [], missing_keywords: [], limitations };
  }

  if (diagnostics && isImport) {
    const primary = ["pdfjs_text", "docx_xml_text", "text_decode"].includes(diagnostics.final_stage);
    add("ats", [
      check("extraction", "Text extraction quality", diagnostics.quality.score / 100, 60, `${diagnostics.quality.confidence} extraction confidence (${diagnostics.quality.score}/100).`, "Check the extracted content against the original document."),
      check("text_layer", "Readable text layer", primary ? 1 : 0, 40, primary ? "Text was extracted directly from the file." : "The file required fallback extraction.", "Export a document with selectable text rather than a scanned image.")
    ]);
  } else add("ats", [], isImport ? "Extraction diagnostics are unavailable for this older upload. Re-upload to assess parseability." : "No uploaded or exported file was tested. Parseability is not assessed.");

  const contactText = [...populated.filter(s => ["personal_info", "header", "contact", "contact_info"].includes(s.type)).flatMap(s => s.blocks.map(b => flattenFields(b.fields))), ...Object.entries(input.content!.metadata).filter(([key]) => ["name", "full_name", "email", "phone"].includes(key)).flatMap(([, value]) => strings(value))].join("\n");
  const hasName = populated.some(s => ["personal_info", "header", "contact", "contact_info"].includes(s.type) && field(s, "name", "full_name", "first_name")) || Boolean(strings(input.content!.metadata.full_name ?? input.content!.metadata.name).length);
  const hasContact = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(contactText) || /\+?\d[\d ()-]{7,}\d/.test(contactText);
  add("sections", [
    check("identity", "Name and contact details", (Number(hasName) + Number(hasContact)) / 2, 30, `${hasName ? "Name found" : "Name missing"}; ${hasContact ? "contact method found" : "email or phone missing"}.`, "Include your name and a reachable email or phone number."),
    check("experience", "Experience or projects", Number(populated.some(s => EXPERIENCE.has(s.type))), 30, populated.some(s => EXPERIENCE.has(s.type)) ? "Populated experience or project content found." : "No populated experience or project section found.", "Add work, clinical, volunteer experience or projects with specific contributions."),
    check("education", "Education or qualifications", Number(populated.some(s => EDUCATION.has(s.type))), 20, populated.some(s => EDUCATION.has(s.type)) ? "Education or qualifications found." : "No populated education or qualifications found.", "Include your education or relevant professional qualifications."),
    check("skills", "Skills", Number(populated.some(s => SKILLS.has(s.type))), 20, populated.some(s => SKILLS.has(s.type)) ? "Populated skills section found." : "No populated skills section found.", "Add a focused skills section using skills you can substantiate.")
  ]);

  const descriptionKeywords = input.job ? extractJobKeywords(input.job.job_description) : [];
  // Validate AI / selected terms against the job description; never invent target requirements.
  const suppliedKeywords = (input.keywords ?? []).map(normalize).filter(term => term && term.length <= 80 && input.job && contains(input.job.job_description, term));
  const keywords = [...new Set([...suppliedKeywords, ...descriptionKeywords])].slice(0, 30);
  const matched = keywords.filter(term => contains(text, term));
  const missing = keywords.filter(term => !contains(text, term));
  const evidenceText = populated.filter(s => EXPERIENCE.has(s.type) || s.type === "summary").flatMap(s => s.blocks.map(b => flattenFields(b.fields))).join("\n");
  if (input.job && keywords.length) {
    const titleTerms = [...new Set(tokens(input.job.job_title).filter(term => !STOP_WORDS.has(term)))];
    const titleMatches = titleTerms.filter(term => contains(text, term));
    const contextualMatches = keywords.filter(term => contains(evidenceText, term));
    const relevanceChecks = [check("contextual_relevance", "Job terms in summary, experience or projects", contextualMatches.length / keywords.length, 80, `${contextualMatches.length}/${keywords.length} job terms appear in contextual content: ${contextualMatches.slice(0, 8).join(", ") || "none"}.`, "Describe relevant experience using the job's terminology where it accurately reflects your work.")];
    if (titleTerms.length) relevanceChecks.push(check("role_alignment", "Target role terminology", titleMatches.length / titleTerms.length, 20, `${titleMatches.length}/${titleTerms.length} target title terms found.`, "Make your target role clear in your summary without changing historical job titles."));
    add("relevance", relevanceChecks);
    add("keywords", [check("keyword_coverage", "Unique job terms covered", matched.length / keywords.length, 100, `${matched.length}/${keywords.length} terms found. Missing: ${missing.slice(0, 8).join(", ") || "none"}.`, "Include missing job terms only when supported by your actual skills or experience.")]);
    limitations.push("Job relevance is a lexical estimate; matching words does not establish proficiency, seniority or qualification.");
  } else {
    const reason = input.job ? "No meaningful job terms could be extracted from this description." : "Add a job description to assess relevance and keyword coverage.";
    add("relevance", [], reason); add("keywords", [], reason);
  }

  const narratives = [...new Set(populated.filter(s => EXPERIENCE.has(s.type)).flatMap(s => s.blocks.flatMap(b => Object.entries(b.fields).filter(([key]) => NARRATIVE_KEYS.has(key)).flatMap(([, value]) => strings(value)))).flatMap(value => value.split(/\n+|(?:^|\s)[•]\s*/)).map(v => v.trim()).filter(Boolean))];
  const clear = narratives.filter(line => wordCount(line) >= 6 && wordCount(line) <= 45).length;
  const actions = narratives.filter(line => ACTION.test(line)).length;
  const specific = narratives.filter(line => !GENERIC.test(line)).length;
  const english = /^en(?:-|$)/i.test(input.content!.language);
  if (!english) add("quality", [], "Wording checks currently support English CVs only.");
  else add("quality", [
    check("concise", "Clear, concise experience statements", narratives.length ? clear / narratives.length : 0, 40, `${clear}/${narratives.length} unique statements contain 6–45 words.${example(narratives.find(line => wordCount(line) < 6 || wordCount(line) > 45))}`, "Write concise experience statements with a specific action and context."),
    check("action", "Statements beginning with an action", narratives.length ? actions / narratives.length : 0, 30, `${actions}/${narratives.length} unique statements begin with a recognized action verb.${example(narratives.find(line => !ACTION.test(line)) ?? narratives[0])}`, "Begin experience statements with concrete verbs such as built, delivered, managed or treated."),
    check("specific", "Wording without generic phrases", narratives.length ? specific / narratives.length : 0, 30, `${specific}/${narratives.length} statements avoid the checked generic phrases.${example(narratives.find(line => GENERIC.test(line)))}`, "Replace phrases such as 'responsible for' or 'team player' with specific examples.")
  ]);
  const measurable = narratives.filter(line => METRIC.test(line)).length;
  add("impact", [check("metrics", "Statements with measurable scope or results", narratives.length ? Math.min(1, measurable / narratives.length / 0.5) : 0, 100, `${measurable}/${narratives.length} unique experience statements include measurable scope or results; full credit at 50%.${example(narratives.find(line => METRIC.test(line)))}`, "Where relevant, quantify outcomes or scope (patients, users, time or cost). Keep every figure factual.")]);

  const emptySections = visibleSections.filter(s => s.blocks.length > 0 && !populated.includes(s)).length;
  const emptyBlocks = visibleSections.flatMap(s => s.blocks).filter(b => !flattenFields(b.fields).trim()).length;
  const titles = populated.map(s => normalize(s.title ?? s.type.replace(/_/g, " ")));
  const corruptText = /\uFFFD|\x00/.test(text);
  add("formatting", [
    check("headings", "Distinct section headings", Number(new Set(titles).size === titles.length), 40, `${titles.length} populated sections; ${titles.length - new Set(titles).size} duplicate headings.`, "Use distinct, descriptive section headings."),
    check("empty", "No empty content placeholders", Number(emptySections === 0 && emptyBlocks === 0), 30, `${emptySections} empty sections and ${emptyBlocks} empty visible blocks.`, "Remove empty placeholders or complete their content."),
    check("characters", "No detected broken text characters", Number(!corruptText), 30, corruptText ? "Broken replacement or null characters detected." : "No replacement or null characters detected in parsed text.", "Fix broken characters and verify the source file's text encoding.")
  ]);

  const assessed = dimensions.filter(d => d.score !== null);
  const weight = assessed.reduce((sum, d) => sum + d.weight, 0);
  const score = round(assessed.reduce((sum, d) => sum + d.weight * d.score!, 0) / weight);
  const strengths = assessed.flatMap(d => d.checks.filter(c => c.points === c.max_points).map(c => `${c.label}: ${c.evidence}`)).slice(0, 6);
  const improvements = assessed.flatMap(d => d.checks.filter(c => c.points < c.max_points).map(c => ({ priority: d.weight * (1 - c.points / c.max_points), suggestion: c.suggestion }))).sort((a, b) => b.priority - a.priority).map(c => c.suggestion);
  const status = weight === 100 ? "complete" : "partial";
  return { version: "cv-review-v1", status, score, assessed_weight: weight, summary: `${score >= 80 ? "Strong CV foundation" : score >= 60 ? "Good foundation with room to improve" : "Several areas need attention"}. ${status === "partial" ? "This score covers only the dimensions we could assess." : "All seven review dimensions were assessed."}`, dimensions, strengths, improvements: [...new Set(improvements)].slice(0, 6), matched_keywords: matched, missing_keywords: missing, limitations };
}

export function reviewTailoring(beforeContent: CvContent, afterContent: CvContent, job: NonNullable<ReviewInput["job"]>, keywords: string[] = []): TailoringReview {
  // Both sides use the same target and available dimensions. No claim about the original file's layout.
  const before = reviewCv({ content: beforeContent, job, keywords });
  const after = reviewCv({ content: afterContent, job, keywords });
  const changes = after.dimensions.flatMap(d => {
    const previous = before.dimensions.find(b => b.id === d.id);
    if (d.score === null || previous?.score === null || previous?.score === undefined || previous.score === d.score) return [];
    const evidence = d.checks.filter(c => previous.checks.find(p => p.id === c.id)?.points !== c.points).map(c => c.evidence).join(" ");
    return [{ dimension: d.id, label: d.label, before: previous.score, after: d.score, reason: evidence }];
  });
  const added = after.matched_keywords.filter(k => !before.matched_keywords.includes(k));
  const removed = before.matched_keywords.filter(k => !after.matched_keywords.includes(k));
  const sectionText = (section: CvSection) => section.blocks.filter(b => b.visibility !== "hidden").map(b => flattenFields(b.fields)).join("\n");
  const changedSections = [...new Set([...beforeContent.sections, ...afterContent.sections].map(s => s.type))].filter(type => beforeContent.sections.filter(s => s.type === type).map(sectionText).join("\n") !== afterContent.sections.filter(s => s.type === type).map(sectionText).join("\n"));
  const scoreChange = before.score !== null && after.score !== null && before.assessed_weight === after.assessed_weight ? after.score - before.score : null;
  return { version: "cv-review-v1", before, after, score_change: scoreChange, changes, added_keywords: added, removed_keywords: removed, changed_sections: changedSections, summary: scoreChange === null ? "A reliable score comparison is unavailable." : scoreChange > 0 ? `Tailoring increased the review score by ${scoreChange} points against the same job criteria.` : scoreChange < 0 ? `The review score decreased by ${Math.abs(scoreChange)} points. Review the changes before applying.` : "Tailoring changed the wording without changing the overall review score." };
}

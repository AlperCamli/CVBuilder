import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import JSZip from "jszip";
import { normalizeCvContent } from "../../../shared/cv-content/cv-content.utils";
import type { CvContent } from "../../../shared/cv-content/cv-content.types";
import type {
  CvParser,
  ExtractCvRawTextResult,
  ParseCvFileDiagnostics,
  ParseCvFileInput,
  ParseCvFileResult,
  ParserExtractionConfidence,
  ParserExtractionStage
} from "./cv-parser";

type SectionType =
  | "header"
  | "summary"
  | "experience"
  | "education"
  | "skills"
  | "languages"
  | "certifications"
  | "courses"
  | "projects"
  | "volunteer"
  | "awards"
  | "publications"
  | "references";

interface SectionDefinition {
  type: SectionType;
  title: string;
  aliases: string[];
  keywords: string[];
}

interface QualityStats {
  score: number;
  confidence: ParserExtractionConfidence;
  lowConfidence: boolean;
  naturalLanguageRatio: number;
  symbolRatio: number;
  repeatedTokenRatio: number;
  entropyRatio: number;
  tokenCount: number;
}

interface ExtractedTextCandidate {
  stage: ParserExtractionStage;
  text: string;
  cleanedText: string;
  quality: QualityStats;
}

const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    type: "header",
    title: "Header",
    aliases: ["header", "contact", "contact info", "contact information", "personal information"],
    keywords: ["contact", "email", "phone", "linkedin", "github", "portfolio", "address"]
  },
  {
    type: "summary",
    title: "Summary",
    aliases: ["summary", "profile", "professional summary", "objective", "about", "about me"],
    keywords: ["summary", "profile", "objective", "about"]
  },
  {
    type: "experience",
    title: "Experience",
    aliases: [
      "experience",
      "experiences",
      "experiences and programs",
      "work experience",
      "professional experience",
      "professional background",
      "employment",
      "employment history",
      "work history",
      "internship",
      "internships",
      "career history"
    ],
    keywords: ["experience", "employment", "worked", "position", "role", "internship", "intern"]
  },
  {
    type: "education",
    title: "Education",
    aliases: ["education", "academic background", "academics", "education background"],
    keywords: ["education", "university", "college", "bachelor", "master", "phd"]
  },
  {
    type: "skills",
    title: "Skills",
    aliases: ["skills", "technical skills", "core skills", "competencies", "technologies"],
    keywords: ["skills", "competencies", "technology", "tech stack", "tools"]
  },
  {
    type: "languages",
    title: "Languages",
    aliases: ["languages", "language skills", "language"],
    keywords: ["language", "languages", "english", "native", "fluent", "proficient"]
  },
  {
    type: "certifications",
    title: "Certifications",
    aliases: ["certifications", "certificates", "licenses"],
    keywords: ["certification", "certificate", "licensed", "credential"]
  },
  {
    type: "courses",
    title: "Courses",
    aliases: ["courses", "coursework", "trainings", "training"],
    keywords: ["course", "training", "bootcamp"]
  },
  {
    type: "projects",
    title: "Projects",
    aliases: ["projects", "project experience", "selected projects"],
    keywords: ["project", "portfolio", "github", "repo"]
  },
  {
    type: "volunteer",
    title: "Volunteer",
    aliases: [
      "volunteer",
      "volunteering",
      "volunteer experience",
      "volunteer work",
      "community service",
      "extracurricular activities",
      "extracurricular activity",
      "leadership activities",
      "leadership and activities"
    ],
    keywords: ["volunteer", "community", "ngo", "mentorship"]
  },
  {
    type: "awards",
    title: "Awards",
    aliases: ["awards", "honors", "achievements"],
    keywords: ["award", "honor", "achievement"]
  },
  {
    type: "publications",
    title: "Publications",
    aliases: ["publications", "research publications", "papers"],
    keywords: ["publication", "paper", "journal", "conference", "doi"]
  },
  {
    type: "references",
    title: "References",
    aliases: ["references", "referees"],
    keywords: ["reference", "referee"]
  }
];

const SECTION_DEFINITION_BY_TYPE = new Map<SectionType, SectionDefinition>(
  SECTION_DEFINITIONS.map((definition) => [definition.type, definition])
);

const LOCATION_KEYWORDS = [
  "istanbul",
  "ankara",
  "izmir",
  "bursa",
  "antalya",
  "turkey",
  "united states",
  "usa",
  "uk",
  "london",
  "berlin",
  "paris",
  "remote",
  "hybrid",
  "on-site",
  "onsite"
];

const textMimeTypes = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
  "text/html",
  "application/rtf",
  "text/rtf"
]);

const docxMimeTypes = new Set([
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-word.document.macroenabled.12"
]);

const textLikeExtensions = new Set([".txt", ".md", ".csv", ".json", ".xml", ".html", ".htm", ".rtf"]);

type InputFileKind = "pdf" | "docx" | "text" | "unknown";

const FALSE_ENV_VALUES = new Set(["0", "false", "off", "no"]);
const TRUE_ENV_VALUES = new Set(["1", "true", "on", "yes"]);

const envFlag = (key: string, defaultValue: boolean): boolean => {
  const rawValue = process.env[key];
  if (!rawValue || rawValue.trim().length === 0) {
    return defaultValue;
  }

  const normalized = rawValue.trim().toLowerCase();
  if (FALSE_ENV_VALUES.has(normalized)) {
    return false;
  }

  if (TRUE_ENV_VALUES.has(normalized)) {
    return true;
  }

  return defaultValue;
};

const envNumber = (key: string, defaultValue: number, min: number, max: number): number => {
  const rawValue = process.env[key];
  if (!rawValue || rawValue.trim().length === 0) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) {
    return defaultValue;
  }

  return Math.max(min, Math.min(max, parsed));
};

type RuntimeImport = <T = unknown>(specifier: string) => Promise<T>;

// Keep true dynamic import in CommonJS output; TS otherwise rewrites import() to require().
const runtimeImport = new Function(
  "specifier",
  "return import(specifier)"
) as RuntimeImport;

const PDFJS_MODULE_SPECIFIER = "pdfjs-dist/legacy/build/pdf.mjs";
const PDFJS_MODULE_FILE_URL = (() => {
  try {
    // Keep a literal require.resolve() so Vercel file tracing includes pdfjs-dist in the lambda bundle.
    const resolvedPath = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
    return pathToFileURL(resolvedPath).href;
  } catch {
    return null;
  }
})();

const resolvePdfJsModuleSpecifier = (): string => {
  return PDFJS_MODULE_FILE_URL ?? PDFJS_MODULE_SPECIFIER;
};

const isPdfOcrEnabled = (): boolean => {
  // Keep OCR off by default during tests to avoid slow/non-deterministic network fetches.
  const defaultValue = process.env.NODE_ENV === "test" ? false : true;
  return envFlag("PDF_OCR_ENABLED", defaultValue);
};

const getPdfOcrLanguages = (): string => {
  const rawValue = process.env.PDF_OCR_LANGUAGES;
  if (!rawValue || rawValue.trim().length === 0) {
    return "eng";
  }

  return rawValue.trim();
};

const getPdfOcrMaxPages = (): number => envNumber("PDF_OCR_MAX_PAGES", 2, 1, 10);
const getPdfOcrRenderScale = (): number => envNumber("PDF_OCR_RENDER_SCALE", 2, 1, 4);
const getPdfOcrCachePath = (): string => {
  const rawValue = process.env.PDF_OCR_CACHE_PATH;
  if (!rawValue || rawValue.trim().length === 0) {
    return "/tmp/cv-builder-ocr-cache";
  }

  return rawValue.trim();
};

const decodeUtf8 = (bytes: Uint8Array): string => {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return decoder.decode(bytes);
};

const hasPdfMagic = (bytes: Uint8Array): boolean => {
  if (bytes.length < 5) {
    return false;
  }

  return (
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d // -
  );
};

const hasZipMagic = (bytes: Uint8Array): boolean => {
  if (bytes.length < 4) {
    return false;
  }

  return bytes[0] === 0x50 && bytes[1] === 0x4b && [0x03, 0x05, 0x07].includes(bytes[2]);
};

const resolveInputFileKind = (input: ParseCvFileInput): InputFileKind => {
  const mimeType = input.mimeType.toLowerCase().trim();
  const extension = extname(input.originalFilename).toLowerCase();

  if (mimeType === "application/pdf" || extension === ".pdf" || hasPdfMagic(input.bytes)) {
    return "pdf";
  }

  if (docxMimeTypes.has(mimeType) || extension === ".docx") {
    return "docx";
  }

  if (textMimeTypes.has(mimeType) || mimeType.startsWith("text/") || textLikeExtensions.has(extension)) {
    return "text";
  }

  if (hasZipMagic(input.bytes) && extension !== ".xlsx" && extension !== ".pptx") {
    return "docx";
  }

  return "unknown";
};

const round = (value: number, digits = 3): number => {
  const precision = 10 ** digits;
  return Math.round(value * precision) / precision;
};

const normalizeFolded = (value: string): string => {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const headingAliasLookup = (() => {
  const lookup = new Map<string, SectionType>();

  for (const definition of SECTION_DEFINITIONS) {
    for (const alias of definition.aliases) {
      lookup.set(normalizeFolded(alias), definition.type);
    }
  }

  return lookup;
})();

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const splitInlineHeadingLine = (line: string): string[] => {
  const trimmed = line.trim();

  if (!trimmed) {
    return [];
  }

  for (const definition of SECTION_DEFINITIONS) {
    if (definition.type === "header") {
      continue;
    }

    const aliasesBySpecificity = [...definition.aliases].sort((left, right) => right.length - left.length);

    for (const alias of aliasesBySpecificity) {
      const aliasNormalized = alias.trim();
      if (!aliasNormalized) {
        continue;
      }

      const directPrefixPattern = new RegExp(`^${escapeRegExp(aliasNormalized)}(?:\\s*[:\\-–])?\\s+`, "i");
      if (directPrefixPattern.test(trimmed)) {
        const remainder = trimmed.replace(directPrefixPattern, "").trim();
        if (!remainder) {
          return [trimmed];
        }

        return [aliasNormalized, remainder];
      }

      if (trimmed.length > aliasNormalized.length + 2) {
        const startsWithAlias =
          trimmed.slice(0, aliasNormalized.length).toLowerCase() === aliasNormalized.toLowerCase();

        if (startsWithAlias) {
          const afterAlias = trimmed
            .slice(aliasNormalized.length)
            .replace(/^[\s:\-–]+/, "")
            .trim();

          if (afterAlias.length > 0 && /^[A-Za-zÇĞİÖŞÜçğıöşü]/.test(afterAlias)) {
            return [aliasNormalized, afterAlias];
          }
        }
      }
    }
  }

  return [trimmed];
};

const dedupe = (items: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of items) {
    const normalized = item.trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
  }

  return output;
};

const getUrlCandidates = (value: string): string[] => {
  const directMatches = value.match(/(?:https?:\/\/|www\.)[^\s<>()]+/gi) ?? [];
  const handleMatches =
    value.match(/\b(?:linkedin|github|gitlab|behance|dribbble|medium|in)\/[A-Za-z0-9._-]{2,}\b/gi) ??
    [];

  const normalizedDirect = directMatches.map((candidate) =>
    candidate
      .replace(/[),.;!?]+$/, "")
      .replace(/^www\./i, "https://www.")
  );

  const normalizedHandles = handleMatches.map((handle) => {
    const [platformRaw, handleValue] = handle.split("/");
    const platform = platformRaw.toLowerCase();

    if (platform === "in" || platform === "linkedin") {
      return `https://www.linkedin.com/in/${handleValue}`;
    }

    if (platform === "github") {
      return `https://github.com/${handleValue}`;
    }

    if (platform === "gitlab") {
      return `https://gitlab.com/${handleValue}`;
    }

    return `https://${platform}.com/${handleValue}`;
  });

  return dedupe([...normalizedDirect, ...normalizedHandles]);
};

const normalizeEmailSpacing = (value: string): string => {
  return value.replace(/([A-Z0-9._%+-])\s*@\s*([A-Z0-9.-]+\.[A-Z]{2,})/gi, "$1@$2");
};

const extractEmailCandidates = (value: string): string[] => {
  const normalized = normalizeEmailSpacing(value);
  const matches = normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  const unique = new Map<string, string>();

  for (const email of matches) {
    const key = email.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, key);
    }
  }

  return [...unique.values()];
};

const hasContactSignal = (line: string): boolean => {
  if (extractEmailCandidates(line).length > 0) {
    return true;
  }

  if (/\+?\d[\d\s().-]{6,}\d/.test(line)) {
    return true;
  }

  if (/\b(?:linkedin|github|gitlab|behance|dribbble|medium|in)\/[A-Za-z0-9._-]{2,}\b/i.test(line)) {
    return true;
  }

  return getUrlCandidates(line).length > 0;
};

const normalizeLineArtifacts = (value: string): string => {
  return value
    .replace(/^\d{6,}\s*(?=[A-Za-zÇĞİÖŞÜçğıöşü])/g, "")
    .replace(/\b\d{6,}(?=[A-Za-zÇĞİÖŞÜçğıöşü])/g, "")
    .replace(/centerbottomconfidential/gi, " ")
    .replace(/\b(?:centerbottom|centertop|footer)\b/gi, " ")
    .replace(/\bconfidential\b/gi, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
};

const isLikelyPdfNoiseLine = (line: string): boolean => {
  const trimmed = line.trim();

  if (!trimmed) {
    return true;
  }

  const folded = normalizeFolded(trimmed);

  const hardNoisePatterns = [
    /^\d+\s+\d+\s+obj\b/i,
    /^endobj$/i,
    /^stream$/i,
    /^endstream$/i,
    /^xref$/i,
    /^trailer$/i,
    /^startxref$/i,
    /^%%eof$/i,
    /^\/(?:Type|Subtype|Font|BaseFont|Encoding|ToUnicode|Length|Filter|ProcSet)\b/i,
    /^CIDInit/i,
    /^begincmap$/i,
    /^endcmap$/i,
    /^begincodespacerange$/i,
    /^endcodespacerange$/i,
    /^beginbfchar$/i,
    /^endbfchar$/i,
    /^beginbfrange$/i,
    /^endbfrange$/i,
    /^BT$/,
    /^ET$/,
    /^q$/,
    /^Q$/
  ];

  if (hardNoisePatterns.some((pattern) => pattern.test(trimmed))) {
    return true;
  }

  if ((folded.includes("adobe") || folded.includes("identity")) && folded.split(" ").length <= 5) {
    return true;
  }

  if (/^[0-9A-Fa-f\s]{24,}$/.test(trimmed)) {
    return true;
  }

  if (/(?:\bobj\b|\bendobj\b|\bstream\b|\bendstream\b|\bxref\b|\btrailer\b|\bstartxref\b)/i.test(trimmed)) {
    const letterCount = [...trimmed].filter((char) => /\p{L}/u.test(char)).length;
    if (letterCount / Math.max(trimmed.length, 1) < 0.35) {
      return true;
    }
  }

  const unsupportedSymbols = [...trimmed].filter(
    (char) => !/[\p{L}\p{N}\s.,;:!?@&/()\[\]{}+\-_*'"%#=|<>•·]/u.test(char)
  ).length;

  if (unsupportedSymbols / Math.max(trimmed.length, 1) > 0.5 && !hasContactSignal(trimmed)) {
    return true;
  }

  if (/^[\d\W_]+$/.test(trimmed) && trimmed.length > 20 && !hasContactSignal(trimmed)) {
    return true;
  }

  return false;
};

const cleanupExtractedText = (value: string): string => {
  const normalized = value
    .replace(/\u0000/g, " ")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  const lines = normalized.split("\n");
  const keptLines: string[] = [];
  const repeatCount = new Map<string, number>();
  const seenUrlOnlyLine = new Set<string>();

  for (const rawLine of lines) {
    const line = normalizeLineArtifacts(rawLine.replace(/[ \t]+/g, " ").trim());

    if (!line) {
      continue;
    }

    const key = line.toLowerCase();
    const nextRepeat = (repeatCount.get(key) ?? 0) + 1;
    repeatCount.set(key, nextRepeat);

    if (nextRepeat > 3) {
      continue;
    }

    if (isLikelyPdfNoiseLine(line)) {
      continue;
    }

    const urls = getUrlCandidates(line);
    if (urls.length === 1 && line.replace(urls[0], "").trim().length === 0) {
      const normalizedUrl = urls[0].toLowerCase();
      if (seenUrlOnlyLine.has(normalizedUrl)) {
        continue;
      }

      seenUrlOnlyLine.add(normalizedUrl);
    }

    keptLines.push(line);
  }

  return keptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

const evaluateTextQuality = (text: string): QualityStats => {
  if (!text.trim()) {
    return {
      score: 0,
      confidence: "low",
      lowConfidence: true,
      naturalLanguageRatio: 0,
      symbolRatio: 1,
      repeatedTokenRatio: 1,
      entropyRatio: 1,
      tokenCount: 0
    };
  }

  let alphaChars = 0;
  let numericChars = 0;
  let symbolChars = 0;
  const nonWhitespace = [...text].filter((char) => !/\s/u.test(char));

  for (const char of nonWhitespace) {
    if (/\p{L}/u.test(char)) {
      alphaChars += 1;
    } else if (/\p{N}/u.test(char)) {
      numericChars += 1;
    } else {
      symbolChars += 1;
    }
  }

  const charCounts = new Map<string, number>();
  for (const char of nonWhitespace) {
    charCounts.set(char, (charCounts.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of charCounts.values()) {
    const probability = count / Math.max(nonWhitespace.length, 1);
    entropy -= probability * Math.log2(probability);
  }

  const maxEntropy = charCounts.size > 1 ? Math.log2(charCounts.size) : 1;
  const entropyRatio = entropy / maxEntropy;

  const tokens = text.toLowerCase().match(/\p{L}[\p{L}\p{M}'’-]*/gu) ?? [];
  const uniqueTokens = new Set(tokens);
  const repeatedTokenRatio = tokens.length > 0 ? 1 - uniqueTokens.size / tokens.length : 1;

  const totalChars = Math.max(nonWhitespace.length, 1);
  const naturalLanguageRatio = alphaChars / totalChars;
  const symbolRatio = symbolChars / totalChars;

  let score = 100;

  if (text.length < 240) {
    score -= 10;
  }

  if (tokens.length < 40) {
    score -= 10;
  }

  if (tokens.length < 20) {
    score -= 10;
  }

  if (naturalLanguageRatio < 0.52) {
    score -= 20;
  }

  if (naturalLanguageRatio < 0.38) {
    score -= 10;
  }

  if (symbolRatio > 0.28) {
    score -= 15;
  }

  if (symbolRatio > 0.38) {
    score -= 10;
  }

  if (repeatedTokenRatio > 0.5) {
    score -= 20;
  }

  if (repeatedTokenRatio > 0.65) {
    score -= 10;
  }

  if (entropyRatio > 0.93 && naturalLanguageRatio < 0.5) {
    score -= 10;
  }

  const normalizedScore = Math.max(0, Math.min(100, Math.round(score)));
  const confidence: ParserExtractionConfidence =
    normalizedScore >= 70 ? "high" : normalizedScore >= 45 ? "medium" : "low";

  return {
    score: normalizedScore,
    confidence,
    lowConfidence: confidence === "low",
    naturalLanguageRatio,
    symbolRatio,
    repeatedTokenRatio,
    entropyRatio,
    tokenCount: tokens.length
  };
};

const decodeXmlEntities = (value: string): string => {
  return value
    .replace(/&#x([0-9A-Fa-f]+);/g, (_match, hex) => {
      const parsed = Number.parseInt(hex, 16);
      return Number.isNaN(parsed) ? "" : String.fromCodePoint(parsed);
    })
    .replace(/&#(\d+);/g, (_match, decimal) => {
      const parsed = Number.parseInt(decimal, 10);
      return Number.isNaN(parsed) ? "" : String.fromCodePoint(parsed);
    })
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
};

const extractTextFromWordXml = (xml: string): string => {
  const paragraphMatches = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];

  if (paragraphMatches.length === 0) {
    const fallbackRuns = [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((match) => decodeXmlEntities(match[1] ?? ""))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);

    return fallbackRuns.join("\n");
  }

  const paragraphs = paragraphMatches
    .map((paragraph) => {
      const withBreaks = paragraph
        .replace(/<w:tab\b[^/>]*\/>/g, "\t")
        .replace(/<w:br\b[^/>]*\/>/g, "\n")
        .replace(/<w:cr\b[^/>]*\/>/g, "\n")
        .replace(/<w:noBreakHyphen\b[^/>]*\/>/g, "-")
        .replace(/<w:softHyphen\b[^/>]*\/>/g, "-");

      const withText = withBreaks.replace(
        /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g,
        (_full, raw) => decodeXmlEntities(raw ?? "")
      );

      return decodeXmlEntities(withText)
        .replace(/<[^>]+>/g, "")
        .replace(/\t+/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\s*\n\s*/g, "\n")
        .trim();
    })
    .filter((item) => item.length > 0);

  return paragraphs.join("\n");
};

const extractDocxTextWithXml = async (bytes: Uint8Array): Promise<string> => {
  const zip = await JSZip.loadAsync(bytes);
  const hasDocumentXml = Boolean(zip.file("word/document.xml"));

  if (!hasDocumentXml) {
    throw new Error("DOCX content part 'word/document.xml' was not found");
  }

  const docParts = Object.keys(zip.files)
    .filter((path) =>
      /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(path)
    )
    .sort((left, right) => {
      if (left === "word/document.xml") {
        return -1;
      }

      if (right === "word/document.xml") {
        return 1;
      }

      return left.localeCompare(right);
    });

  const extractedParts: string[] = [];

  for (const partPath of docParts) {
    const file = zip.file(partPath);
    if (!file) {
      continue;
    }

    const xml = await file.async("string");
    const extracted = extractTextFromWordXml(xml);
    if (!extracted) {
      continue;
    }

    extractedParts.push(extracted);
  }

  return extractedParts.join("\n\n").trim();
};

const decodePdfStringToken = (token: string): string => {
  const withoutParens = token.slice(1, -1);

  return withoutParens
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8)));
};

const extractPdfTextHeuristic = (bytes: Uint8Array): string => {
  const binary = Buffer.from(bytes).toString("latin1");
  const matches = binary.match(/\((?:\\.|[^\\()])+\)/g) ?? [];

  if (matches.length === 0) {
    return "";
  }

  return matches.slice(0, 20000).map((token) => decodePdfStringToken(token)).join("\n");
};

const extractPdfTextWithPdfJs = async (bytes: Uint8Array): Promise<string> => {
  const pdfjs = (await runtimeImport(resolvePdfJsModuleSpecifier())) as {
    getDocument: (params: Record<string, unknown>) => { promise: Promise<any> };
  };

  const loadingTask = pdfjs.getDocument({
    data: bytes,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true
  });

  const document = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const textContent = await page.getTextContent();

    type PositionedText = { text: string; x: number; y: number };
    const positionedItems: PositionedText[] = [];

    for (const item of textContent.items as Array<Record<string, unknown>>) {
      const text = typeof item.str === "string" ? item.str.replace(/\s+/g, " ").trim() : "";
      if (!text) {
        continue;
      }

      const transform = Array.isArray(item.transform) ? item.transform : [];
      const x = typeof transform[4] === "number" ? transform[4] : 0;
      const y = typeof transform[5] === "number" ? transform[5] : 0;

      positionedItems.push({ text, x, y });
    }

    if (positionedItems.length === 0) {
      pages.push("");
      continue;
    }

    const lineMap = new Map<string, PositionedText[]>();

    for (const item of positionedItems) {
      const yKey = String(Math.round(item.y * 10) / 10);
      const existing = lineMap.get(yKey) ?? [];
      lineMap.set(yKey, [...existing, item]);
    }

    const sortedLineKeys = [...lineMap.keys()].sort((a, b) => Number(b) - Number(a));
    const lines = sortedLineKeys
      .flatMap((lineKey) => {
        const lineItems = (lineMap.get(lineKey) ?? []).sort((left, right) => left.x - right.x);
        const lineText = lineItems.map((item) => item.text).join(" ").replace(/\s+/g, " ").trim();

        return lineText ? [lineText] : [];
      })
      .filter((line) => line.length > 0);

    pages.push(lines.join("\n"));
  }

  if (typeof document.destroy === "function") {
    await document.destroy();
  }

  return pages.join("\n\n").trim();
};

const extractPdfTextWithOcr = async (bytes: Uint8Array): Promise<string> => {
  const [{ createCanvas }, pdfjsModule, tesseract] = await Promise.all([
    import("@napi-rs/canvas"),
    runtimeImport(resolvePdfJsModuleSpecifier()),
    import("tesseract.js")
  ]);
  const pdfjs = pdfjsModule as {
    getDocument: (params: Record<string, unknown>) => { promise: Promise<any> };
  };

  const loadingTask = pdfjs.getDocument({
    data: bytes,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false
  });

  const document = await loadingTask.promise;
  const pageTexts: string[] = [];
  const maxPages = Math.min(document.numPages, getPdfOcrMaxPages());
  const renderScale = getPdfOcrRenderScale();
  const languages = getPdfOcrLanguages();

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: renderScale });
    const width = Math.max(1, Math.ceil(viewport.width));
    const height = Math.max(1, Math.ceil(viewport.height));

    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      continue;
    }

    await page
      .render({
        canvasContext: context as any,
        viewport
      })
      .promise;

    const imageBytes = canvas.toBuffer("image/png");
    const result = await tesseract.recognize(imageBytes, languages, {
      logger: () => undefined,
      cachePath: getPdfOcrCachePath()
    });

    const text = typeof result?.data?.text === "string" ? result.data.text : "";
    if (text.trim().length > 0) {
      pageTexts.push(text.trim());
    }

    if (typeof page.cleanup === "function") {
      page.cleanup();
    }
  }

  if (typeof document.destroy === "function") {
    await document.destroy();
  }

  return pageTexts.join("\n\n").trim();
};

const toLines = (text: string): string[] => {
  return text
    .split(/\r?\n/)
    .flatMap((line) => splitInlineHeadingLine(line))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const looksLikeHeading = (line: string): boolean => {
  if (line.length > 90) {
    return false;
  }

  if (hasContactSignal(line)) {
    return false;
  }

  const folded = normalizeFolded(line.replace(/[:\-–]+$/, ""));
  const wordCount = folded ? folded.split(" ").length : 0;

  if (wordCount === 0 || wordCount > 7) {
    return false;
  }

  if (/[.!?]$/.test(line)) {
    return false;
  }

  return true;
};

const headingAliasPattern = (alias: string): RegExp => {
  const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escapedAlias}(?:\\s+(?:section|details|history|highlights|overview|profile))?$`, "i");
};

const isLikelyHeadingFalsePositive = (line: string): boolean => {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }

  if (/[.!?]$/.test(trimmed)) {
    return true;
  }

  if (/\b(?:19|20)\d{2}\b/.test(trimmed) || /\d{1,2}[./-]\d{4}/.test(trimmed)) {
    return true;
  }

  if (hasContactSignal(trimmed)) {
    return true;
  }

  if (trimmed.includes(",") && trimmed.split(/\s+/).length > 6) {
    return true;
  }

  if (/\b(?:at|from|for)\b/i.test(trimmed) && trimmed.split(/\s+/).length > 6) {
    return true;
  }

  return false;
};

const findSectionByHeading = (line: string): SectionDefinition | null => {
  if (!looksLikeHeading(line)) {
    return null;
  }

  if (isLikelyHeadingFalsePositive(line)) {
    return null;
  }

  const normalized = normalizeFolded(line.replace(/[:\-–]+$/, ""));
  if (!normalized) {
    return null;
  }

  const exact = headingAliasLookup.get(normalized);
  if (exact) {
    return SECTION_DEFINITION_BY_TYPE.get(exact) ?? null;
  }

  for (const definition of SECTION_DEFINITIONS) {
    for (const alias of definition.aliases) {
      const aliasFolded = normalizeFolded(alias);
      if (!aliasFolded) {
        continue;
      }

      if (headingAliasPattern(aliasFolded).test(normalized)) {
        return definition;
      }
    }
  }

  return null;
};

const containsAnyKeyword = (line: string, keywords: string[]): boolean => {
  const folded = normalizeFolded(line);

  return keywords.some((keyword) => {
    const normalizedKeyword = normalizeFolded(keyword);
    if (!normalizedKeyword) {
      return false;
    }

    const boundaryPattern = new RegExp(`(^|\\s)${normalizedKeyword.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(\\s|$)`);
    return boundaryPattern.test(folded);
  });
};

const splitDelimitedItems = (line: string): string[] => {
  return dedupe(
    line
      .split(/[;,|•·]/g)
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  );
};

const parseBulletItem = (line: string): string | null => {
  const match = line.match(/^(?:[-*•·▪◦]+)\s*(.+)$/);

  if (!match) {
    return null;
  }

  const value = match[1].trim();
  return value || null;
};

const isLikelySkillsLine = (line: string): boolean => {
  if (containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("skills")?.keywords ?? [])) {
    return true;
  }

  const items = splitDelimitedItems(line);
  return items.length >= 3 && items.every((item) => item.split(/\s+/).length <= 5);
};

const isLikelyEducationLine = (line: string): boolean => {
  if (containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("education")?.keywords ?? [])) {
    return true;
  }

  return /\b(?:bsc|msc|ba|ma|phd|associate|bachelor|master|university|college)\b/i.test(line);
};

const isLikelyExperienceLine = (line: string): boolean => {
  if (containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("experience")?.keywords ?? [])) {
    return true;
  }

  const hasYear = /\b(?:19|20)\d{2}\b/.test(line);
  const hasRangeConnector = /(?:-|–|—|to|present|current|now)/i.test(line);

  return hasYear && hasRangeConnector;
};

const classifyUnheadedLine = (line: string): SectionType => {
  if (isLikelyNameLine(line)) {
    return "header";
  }

  if (hasContactSignal(line) || containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("header")?.keywords ?? [])) {
    return "header";
  }

  if (containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("languages")?.keywords ?? [])) {
    return "languages";
  }

  if (containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("certifications")?.keywords ?? [])) {
    return "certifications";
  }

  if (containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("courses")?.keywords ?? [])) {
    return "courses";
  }

  if (containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("projects")?.keywords ?? [])) {
    return "projects";
  }

  if (containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("volunteer")?.keywords ?? [])) {
    return "volunteer";
  }

  if (containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("awards")?.keywords ?? [])) {
    return "awards";
  }

  if (containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("publications")?.keywords ?? [])) {
    return "publications";
  }

  if (containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("references")?.keywords ?? [])) {
    return "references";
  }

  if (isLikelyEducationLine(line)) {
    return "education";
  }

  if (isLikelySkillsLine(line)) {
    return "skills";
  }

  if (isLikelyExperienceLine(line)) {
    return "experience";
  }

  return "summary";
};

const createBuckets = (): Map<SectionType, string[]> => {
  const buckets = new Map<SectionType, string[]>();

  for (const definition of SECTION_DEFINITIONS) {
    buckets.set(definition.type, []);
  }

  return buckets;
};

const segmentWithoutHeadings = (lines: string[]): Map<SectionType, string[]> => {
  const buckets = createBuckets();

  for (const line of lines) {
    const section = classifyUnheadedLine(line);
    const existing = buckets.get(section) ?? [];
    buckets.set(section, [...existing, line]);
  }

  return buckets;
};

const segmentByHeadings = (lines: string[]): { buckets: Map<SectionType, string[]>; headingCount: number } => {
  const buckets = createBuckets();
  const prefaceLines: string[] = [];

  let activeSection: SectionType | null = null;
  let headingCount = 0;

  for (const line of lines) {
    const heading = findSectionByHeading(line);

    if (heading) {
      activeSection = heading.type;
      headingCount += 1;
      continue;
    }

    if (!activeSection) {
      prefaceLines.push(line);
      continue;
    }

    const existing = buckets.get(activeSection) ?? [];
    buckets.set(activeSection, [...existing, line]);
  }

  if (headingCount === 0) {
    return {
      buckets: segmentWithoutHeadings(lines),
      headingCount
    };
  }

  if (prefaceLines.length > 0) {
    const prefaceBuckets = segmentWithoutHeadings(prefaceLines);

    for (const definition of SECTION_DEFINITIONS) {
      const type = definition.type;
      const merged = [...(prefaceBuckets.get(type) ?? []), ...(buckets.get(type) ?? [])];
      buckets.set(type, merged);
    }
  }

  return {
    buckets,
    headingCount
  };
};

const isLikelyNameLine = (line: string): boolean => {
  if (hasContactSignal(line) || findSectionByHeading(line)) {
    return false;
  }

  if (line.length < 3 || line.length > 80) {
    return false;
  }

  if (/\d/.test(line)) {
    return false;
  }

  if (/[.,;:!?]/.test(line)) {
    return false;
  }

  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) {
    return false;
  }

  if (words.some((word) => word.length <= 1)) {
    return false;
  }

  const looksLikeNameToken = (word: string): boolean => {
    return /^(?:\p{Lu}[\p{L}'’.-]*|[\p{Lu}]{2,})$/u.test(word);
  };

  if (!words.every(looksLikeNameToken)) {
    return false;
  }

  return true;
};

const foldWrappedLines = (lines: string[]): string[] => {
  const folded: string[] = [];
  const bulletPattern = /^(?:[-*•·▪◦]+)\s*/;

  const appendToLast = (line: string): void => {
    const lastIndex = folded.length - 1;
    const current = folded[lastIndex] ?? "";
    const connector = /[-\u2013\u2014]$/.test(current) ? "" : " ";
    folded[lastIndex] = `${current}${connector}${line}`.replace(/\s+/g, " ").trim();
  };

  for (const line of lines) {
    if (folded.length === 0) {
      folded.push(line);
      continue;
    }

    const previous = folded[folded.length - 1];
    const previousIsHeading = Boolean(findSectionByHeading(previous));
    const currentIsHeading = Boolean(findSectionByHeading(line));
    const previousIsBullet = bulletPattern.test(previous);
    const currentIsBullet = bulletPattern.test(line);
    const startsLowercase = /^[a-z(]/.test(line);
    const dateRange = extractDateRangeFromText(line);
    const looksLikeEntryStart = Boolean(dateRange.startDate && (dateRange.endDate || dateRange.currentRole));
    const previousEndsSoftly = /[,;:/-]$/.test(previous) || !/[.!?]$/.test(previous);
    const mergeAfterBullet =
      previousIsBullet &&
      !currentIsBullet &&
      !currentIsHeading &&
      !looksLikeEntryStart &&
      (startsLowercase || previousEndsSoftly);
    const mergeByContinuation =
      !previousIsHeading &&
      !currentIsHeading &&
      !currentIsBullet &&
      !hasContactSignal(line) &&
      (startsLowercase || previousEndsSoftly);

    if (mergeAfterBullet || mergeByContinuation) {
      appendToLast(line);
      continue;
    }

    folded.push(line);
  }

  return folded;
};

const extractName = (lines: string[]): string | null => {
  const topLines = lines.slice(0, 12);

  for (const line of topLines) {
    if (isLikelyNameLine(line)) {
      return line;
    }
  }

  return null;
};

const extractHeadline = (lines: string[], fullName: string | null): string | null => {
  const topLines = lines.slice(0, 8);

  for (const line of topLines) {
    if (line === fullName) {
      continue;
    }

    if (hasContactSignal(line) || findSectionByHeading(line)) {
      continue;
    }

    if (line.length < 5 || line.length > 100) {
      continue;
    }

    if (/^(?:[-*•·▪◦]+)/.test(line)) {
      continue;
    }

    if (/\b(?:19|20)\d{2}\b/.test(line)) {
      continue;
    }

    if (/\b(?:linkedin|github|gitlab|behance|dribbble|medium|in)\/[A-Za-z0-9._-]{2,}\b/i.test(line)) {
      continue;
    }

    if (/\b(?:summary|experience|education|skills|projects)\b/i.test(line)) {
      continue;
    }

    if (/^(?:title|heading)$/i.test(line.trim())) {
      continue;
    }

    if (/\b(?:contact information|birth date|language skills|english|spanish)\b/i.test(line)) {
      continue;
    }

    if (
      containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("education")?.keywords ?? []) ||
      containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("experience")?.keywords ?? [])
    ) {
      continue;
    }

    return line;
  }

  return null;
};

const extractEmail = (text: string, lines: string[]): string | null => {
  const candidates = extractEmailCandidates(text);
  if (candidates.length === 0) {
    return null;
  }

  const normalizedLines = lines.map((line) => normalizeEmailSpacing(line).toLowerCase());
  const normalizedText = normalizeEmailSpacing(text).toLowerCase();
  const topWindow = normalizedLines.slice(0, 10).join(" ");

  const scored = candidates
    .map((candidate) => {
      const lowerCandidate = candidate.toLowerCase();
      const lineIndex = normalizedLines.findIndex((line) => line.includes(lowerCandidate));
      const textIndex = normalizedText.indexOf(lowerCandidate);
      const lineValue = lineIndex >= 0 ? normalizedLines[lineIndex] : "";
      let score = 0;

      if (topWindow.includes(lowerCandidate)) {
        score += 8;
      }

      if (lineIndex >= 0) {
        score += Math.max(0, 6 - lineIndex);
      }

      if (textIndex >= 0) {
        score += Math.max(0, 5 - Math.floor(textIndex / 240));
      }

      if (/(gmail|outlook|hotmail|icloud|yahoo|proton|pm\.me)\./i.test(candidate)) {
        score += 2;
      }

      if (/(reference|referee)/i.test(lineValue)) {
        score -= 3;
      }

      return { candidate, score, textIndex };
    })
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      return left.textIndex - right.textIndex;
    });

  return scored[0]?.candidate ?? null;
};

const extractPhone = (text: string): string | null => {
  const matches = [...text.matchAll(/\+?\d[\d\s().-]{6,}\d/g)]
    .map((match) => match[0].trim())
    .filter((value) => value.length > 0);

  if (matches.length === 0) {
    return null;
  }

  const toDigits = (value: string): string => value.replace(/\D/g, "");
  const withReasonableLength = matches.filter((value) => {
    const digitLength = toDigits(value).length;
    return digitLength >= 10 && digitLength <= 15;
  });

  const candidates = withReasonableLength.length > 0 ? withReasonableLength : matches;

  const scored = candidates
    .map((value) => {
      const digitLength = toDigits(value).length;
      let score = 0;

      if (value.startsWith("+")) {
        score += 3;
      }

      if (/[().\s-]/.test(value)) {
        score += 2;
      }

      if (/^\d{11,}$/.test(value)) {
        score -= 2;
      }

      if (digitLength >= 10 && digitLength <= 13) {
        score += 1;
      }

      return { value, score };
    })
    .sort((left, right) => right.score - left.score);

  return scored[0]?.value ?? null;
};

const extractLocation = (lines: string[]): string | null => {
  const topLines = lines.slice(0, 24);

  const extractLocationPhrase = (line: string): string | null => {
    const matches = line.match(/[A-Za-zÇĞİÖŞÜçğıöşü.-]+,\s*[A-Za-zÇĞİÖŞÜçğıöşü.-]+/g) ?? [];

    for (const match of matches) {
      const folded = normalizeFolded(match);
      if (/\b(candidate|student|manager|engineering)\b/i.test(match)) {
        continue;
      }

      if (LOCATION_KEYWORDS.some((keyword) => folded.includes(keyword))) {
        return match.trim();
      }
    }

    return null;
  };

  for (const line of topLines) {
    const inlineLocation = extractLocationPhrase(line);
    if (inlineLocation) {
      return inlineLocation;
    }

    if (hasContactSignal(line) || findSectionByHeading(line)) {
      continue;
    }

    const folded = normalizeFolded(line);

    if (/^(?:[-*•·▪◦]+)/.test(line)) {
      continue;
    }

    if (line.length > 48) {
      continue;
    }

    if (/\b(member|intern|engineer|consultant|assistant|advisor)\b/i.test(line)) {
      continue;
    }

    if (/\b(university|college|student|engineering)\b/i.test(line)) {
      continue;
    }

    if (/\b(language|english|spanish|native|advanced|beginner)\b/i.test(line)) {
      continue;
    }

    if (LOCATION_KEYWORDS.some((keyword) => folded.includes(keyword))) {
      return line;
    }

    if (line.includes(",") && line.split(/\s+/).length <= 8 && !/\d{3,}/.test(line)) {
      return line;
    }
  }

  return null;
};

const splitSkillItems = (lines: string[]): string[] => {
  const items = lines.flatMap((line) => {
    const bullet = parseBulletItem(line);
    if (bullet) {
      return [bullet];
    }

    return splitDelimitedItems(line);
  });

  return dedupe(items);
};

const normalizeWhitespaceText = (value: string): string => value.replace(/\s+/g, " ").trim();

const monthTokenPattern = [
  "jan(?:uary)?",
  "feb(?:ruary)?",
  "mar(?:ch)?",
  "apr(?:il)?",
  "may",
  "jun(?:e)?",
  "jul(?:y)?",
  "aug(?:ust)?",
  "sep(?:t(?:ember)?)?",
  "oct(?:ober)?",
  "nov(?:ember)?",
  "dec(?:ember)?"
].join("|");

const dateTokenPattern = `(?:${monthTokenPattern})\\s+\\d{4}|\\d{1,2}[./-]\\d{4}|\\d{4}`;
const dateRangePattern = new RegExp(
  `(${dateTokenPattern})\\s*(?:-|–|—|to)\\s*(present|current|now|${dateTokenPattern})`,
  "i"
);

const normalizeDateToken = (value: string): string => {
  const normalized = normalizeWhitespaceText(value.replace(/[()]/g, ""));
  if (/^(present|current|now)$/i.test(normalized)) {
    return "Present";
  }

  return normalized;
};

const extractDateRangeFromText = (
  rawText: string
): { startDate: string; endDate: string; currentRole: boolean; before: string; after: string } => {
  const text = normalizeWhitespaceText(rawText);
  const match = dateRangePattern.exec(text);

  if (!match || match.index === undefined) {
    return {
      startDate: "",
      endDate: "",
      currentRole: false,
      before: text,
      after: ""
    };
  }

  const startDate = normalizeDateToken(match[1]);
  const endDate = normalizeDateToken(match[2]);
  const currentRole = endDate.toLowerCase() === "present";

  return {
    startDate,
    endDate,
    currentRole,
    before: normalizeWhitespaceText(text.slice(0, match.index)),
    after: normalizeWhitespaceText(text.slice(match.index + match[0].length))
  };
};

const looksLikeRoleOrCompanySegment = (value: string): boolean => {
  const text = normalizeWhitespaceText(value);
  if (!text) {
    return false;
  }

  if (text.length > 80 || /[.;!?]/.test(text)) {
    return false;
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 8) {
    return false;
  }

  if (/^(?:and|or|with|including)$/i.test(words[0] ?? "")) {
    return false;
  }

  const sentenceSignals = /\b(?:designed|developed|implemented|worked|contributed|supported|created|managed|responsible)\b/i;
  if (sentenceSignals.test(text) && words.length > 5) {
    return false;
  }

  return true;
};

const splitRoleCompanyText = (value: string): { role: string; company: string } => {
  const text = normalizeWhitespaceText(value);
  if (!text) {
    return { role: "", company: "" };
  }

  const atMatch = text.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (atMatch && looksLikeRoleOrCompanySegment(atMatch[1]) && looksLikeRoleOrCompanySegment(atMatch[2])) {
    return {
      role: normalizeWhitespaceText(atMatch[1]),
      company: normalizeWhitespaceText(atMatch[2])
    };
  }

  const commaParts = text.split(",").map((part) => normalizeWhitespaceText(part)).filter((part) => part.length > 0);
  if (
    commaParts.length === 2 &&
    looksLikeRoleOrCompanySegment(commaParts[0]) &&
    looksLikeRoleOrCompanySegment(commaParts[1])
  ) {
    return {
      role: commaParts[0],
      company: commaParts[1]
    };
  }

  const separatorMatch = text.match(/^(.+?)\s(?:\||\/|-|–|—)\s(.+)$/);
  if (
    separatorMatch &&
    looksLikeRoleOrCompanySegment(separatorMatch[1]) &&
    looksLikeRoleOrCompanySegment(separatorMatch[2])
  ) {
    return {
      role: normalizeWhitespaceText(separatorMatch[1]),
      company: normalizeWhitespaceText(separatorMatch[2])
    };
  }

  return { role: text, company: "" };
};

const parseExperienceFields = (rawText: string): Record<string, unknown> => {
  const text = normalizeWhitespaceText(rawText);
  if (!text) {
    return {};
  }

  const dateParts = extractDateRangeFromText(text);
  const descriptor = normalizeWhitespaceText(dateParts.before || text);
  const roleCompany = splitRoleCompanyText(descriptor);
  const descriptionFromTail = normalizeWhitespaceText(dateParts.after);

  let description = descriptionFromTail;
  if (!description && !dateParts.startDate && !roleCompany.company && roleCompany.role === descriptor) {
    description = text;
  }

  return {
    role: roleCompany.role,
    company: roleCompany.company,
    start_date: dateParts.startDate,
    end_date: dateParts.endDate,
    current_role: dateParts.currentRole,
    description
  };
};

const parseVolunteerFields = (rawText: string): Record<string, unknown> => {
  const experience = parseExperienceFields(rawText);
  const role = typeof experience.role === "string" ? experience.role : "";
  const company = typeof experience.company === "string" ? experience.company : "";
  const description = typeof experience.description === "string" ? experience.description : "";

  return {
    organization: company,
    role,
    location: "",
    start_date: experience.start_date ?? "",
    end_date: experience.end_date ?? "",
    current_role: experience.current_role ?? false,
    description
  };
};

const parseEducationFields = (rawText: string): Record<string, unknown> => {
  const text = normalizeWhitespaceText(rawText);
  if (!text) {
    return {};
  }

  const dateParts = extractDateRangeFromText(text);
  const gpaMatch = text.match(/\bGPA[:\s]*([0-9]+(?:[.,][0-9]+)?(?:\s*\/\s*[0-9]+(?:[.,][0-9]+)?)?)/i);
  const expectedMatch = text.match(/(?:Expected)\s+([\p{L}0-9./-]+\s*\d{0,4})/iu);
  const institutionMatch = text.match(/([\p{L}0-9&.\- ]+(?:University|Institute|College|School|Technical))/iu);
  const degreeMatch = text.match(/\b(?:B\.?Sc|M\.?Sc|Ph\.?D|Bachelor|Master|Associate)\b[^|,;)]*/i);
  const fieldMatch = text.match(/([\p{L}\s]+(?:Engineering|Management|Design|Science|Business))/iu);

  const expectedGraduation = /(?:expected)/i.test(text);
  const exchangeProgram = /(?:exchange|erasmus)/i.test(text);
  const endDate = dateParts.endDate || (expectedMatch ? normalizeWhitespaceText(expectedMatch[1]) : "");

  return {
    institution: normalizeWhitespaceText(institutionMatch?.[1] ?? ""),
    degree: normalizeWhitespaceText(degreeMatch?.[0] ?? ""),
    field_of_study: normalizeWhitespaceText(fieldMatch?.[1] ?? ""),
    gpa: normalizeWhitespaceText(gpaMatch?.[1] ?? ""),
    start_date: dateParts.startDate,
    end_date: endDate,
    expected_graduation: expectedGraduation,
    exchange_program: exchangeProgram,
    description: text
  };
};

const parseLanguageFields = (rawText: string): Record<string, unknown> => {
  const text = normalizeWhitespaceText(rawText);
  if (!text) {
    return {};
  }

  if (splitDelimitedItems(text).length > 1) {
    return {};
  }

  const bracketMatch = text.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (bracketMatch) {
    return {
      language: normalizeWhitespaceText(bracketMatch[1]),
      proficiency: normalizeWhitespaceText(bracketMatch[2]),
      certificate: "",
      notes: ""
    };
  }

  const separatorMatch = text.match(/^(.+?)\s*[-–—:]\s*(.+)$/);
  if (separatorMatch) {
    return {
      language: normalizeWhitespaceText(separatorMatch[1]),
      proficiency: normalizeWhitespaceText(separatorMatch[2]),
      certificate: "",
      notes: ""
    };
  }

  return {
    language: text,
    proficiency: "",
    certificate: "",
    notes: ""
  };
};

const parseCertificationFields = (rawText: string): Record<string, unknown> => {
  const text = normalizeWhitespaceText(rawText);
  if (!text) {
    return {};
  }

  const url = getUrlCandidates(text)[0] ?? "";
  const verificationMatch = text.match(
    /\b(?:verification(?:\s*id)?|credential(?:\s*id)?|certificate(?:\s*id)?|cert(?:\s*no)?)[:#\s-]*([A-Za-z0-9._-]+)/i
  );
  const withoutUrl = normalizeWhitespaceText(url ? text.replace(url, " ") : text);
  const withoutVerification = normalizeWhitespaceText(
    verificationMatch ? withoutUrl.replace(verificationMatch[0], " ") : withoutUrl
  );

  return {
    name: withoutVerification || text,
    url,
    verification_id: verificationMatch?.[1] ?? ""
  };
};

const parseCourseFields = (rawText: string): Record<string, unknown> => {
  const text = normalizeWhitespaceText(rawText);
  if (!text) {
    return {};
  }

  const url = getUrlCandidates(text)[0] ?? "";
  const withoutUrl = normalizeWhitespaceText(url ? text.replace(url, " ") : text);
  const parts = withoutUrl.split(/\s*[-–—|]\s*/).map((part) => normalizeWhitespaceText(part));

  return {
    title: parts[0] ?? withoutUrl,
    institution: parts[1] ?? "",
    url,
    description: parts.slice(2).join(" ").trim()
  };
};

const parseProjectFields = (rawText: string): Record<string, unknown> => {
  const text = normalizeWhitespaceText(rawText);
  if (!text) {
    return {};
  }

  const dateParts = extractDateRangeFromText(text);
  const descriptor = dateParts.before || text;
  const parts = descriptor.split(/\s*[-–—|]\s*/).map((part) => normalizeWhitespaceText(part));

  return {
    title: parts[0] ?? descriptor,
    subtitle: parts[1] ?? "",
    start_date: dateParts.startDate,
    end_date: dateParts.endDate,
    description: normalizeWhitespaceText(dateParts.after || text)
  };
};

const parseAwardFields = (rawText: string): Record<string, unknown> => {
  const text = normalizeWhitespaceText(rawText);
  if (!text) {
    return {};
  }

  const dateParts = extractDateRangeFromText(text);
  const dateMatch = text.match(/\b(?:19|20)\d{2}\b/);
  const issuerMatch = text.match(/(?:by|from|at)\s+([^,;]+)/i);

  return {
    name: normalizeWhitespaceText(dateParts.before || text),
    issuer: normalizeWhitespaceText(issuerMatch?.[1] ?? ""),
    date: dateParts.endDate || dateParts.startDate || (dateMatch?.[0] ?? ""),
    description: normalizeWhitespaceText(dateParts.after)
  };
};

const parsePublicationFields = (rawText: string): Record<string, unknown> => {
  const text = normalizeWhitespaceText(rawText);
  if (!text) {
    return {};
  }

  const dateParts = extractDateRangeFromText(text);
  const dateMatch = text.match(/\b(?:19|20)\d{2}\b/);
  const publisherMatch = text.match(/(?:published\s+by|publisher|journal|conference|in)\s+([^,;]+)/i);
  const descriptor = normalizeWhitespaceText(dateParts.before || text);
  const splitDescriptor = descriptor.split(/\s*[-–—|]\s*/).map((part) => normalizeWhitespaceText(part));

  return {
    title: splitDescriptor[0] ?? descriptor,
    publisher: normalizeWhitespaceText(publisherMatch?.[1] ?? splitDescriptor[1] ?? ""),
    date: dateParts.endDate || dateParts.startDate || (dateMatch?.[0] ?? ""),
    description: normalizeWhitespaceText(dateParts.after)
  };
};

const parseReferenceFields = (rawText: string): Record<string, unknown> => {
  const text = normalizeWhitespaceText(rawText.replace(/^references?\s*/i, ""));
  if (!text) {
    return {};
  }

  const allPhoneMatches = [...text.matchAll(/\+?\d[\d\s().-]{7,}\d/g)];
  const allEmailMatches = extractEmailCandidates(text);
  if (allPhoneMatches.length > 1 || allEmailMatches.length > 1) {
    return {};
  }

  const emailMatch = allEmailMatches[0] ?? "";
  const phoneMatch = text.match(/\+?\d[\d\s().-]{7,}\d/);
  const withoutEmail = normalizeWhitespaceText(emailMatch ? normalizeEmailSpacing(text).replace(emailMatch, " ") : text);
  const withoutPhone = normalizeWhitespaceText(phoneMatch ? withoutEmail.replace(phoneMatch[0], " ") : withoutEmail);
  const commaParts = withoutPhone
    .split(",")
    .map((part) => normalizeWhitespaceText(part))
    .filter((part) => part.length > 0);

  if (commaParts.length >= 3) {
    return {
      name: commaParts[0],
      job_title: commaParts[1],
      organization: commaParts.slice(2).join(", "),
      email: emailMatch,
      phone: phoneMatch?.[0] ?? ""
    };
  }

  const slashParts = withoutPhone.split("/");
  const name = normalizeWhitespaceText(slashParts[0] ?? "");
  const roleOrg = normalizeWhitespaceText(slashParts.slice(1).join("/"));
  const roleOrgMatch = roleOrg.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);

  return {
    name,
    job_title: normalizeWhitespaceText(roleOrgMatch?.[1] ?? roleOrg),
    organization: normalizeWhitespaceText(roleOrgMatch?.[2] ?? ""),
    email: emailMatch,
    phone: phoneMatch?.[0] ?? ""
  };
};

const inferStructuredFields = (sectionType: SectionType, text: string): Record<string, unknown> => {
  if (!text.trim()) {
    return {};
  }

  switch (sectionType) {
    case "experience":
      return parseExperienceFields(text);
    case "education":
      return parseEducationFields(text);
    case "languages":
      return parseLanguageFields(text);
    case "certifications":
      return parseCertificationFields(text);
    case "courses":
      return parseCourseFields(text);
    case "projects":
      return parseProjectFields(text);
    case "volunteer":
      return parseVolunteerFields(text);
    case "awards":
      return parseAwardFields(text);
    case "publications":
      return parsePublicationFields(text);
    case "references":
      return parseReferenceFields(text);
    default:
      return {};
  }
};

const buildHeaderLines = (lines: string[], metadata: Record<string, unknown>): string[] => {
  const seedLines = [...lines];

  const fullName = typeof metadata.full_name === "string" ? metadata.full_name : "";
  const headline = typeof metadata.headline === "string" ? metadata.headline : "";
  const email = typeof metadata.email === "string" ? metadata.email : "";
  const phone = typeof metadata.phone === "string" ? metadata.phone : "";
  const location = typeof metadata.location === "string" ? metadata.location : "";
  const urls = Array.isArray(metadata.urls) ? (metadata.urls as string[]) : [];

  if (fullName) {
    seedLines.unshift(fullName);
  }

  if (headline && !seedLines.some((line) => line.toLowerCase() === headline.toLowerCase())) {
    seedLines.push(headline);
  }

  if (email && !seedLines.some((line) => line.includes(email))) {
    seedLines.push(email);
  }

  if (phone && !seedLines.some((line) => line.includes(phone))) {
    seedLines.push(phone);
  }

  if (location && !seedLines.some((line) => line.toLowerCase() === location.toLowerCase())) {
    seedLines.push(location);
  }

  for (const url of urls) {
    if (!seedLines.some((line) => line.includes(url))) {
      seedLines.push(url);
    }
  }

  return dedupe(seedLines);
};

type ExperienceStyleSection = "experience" | "volunteer" | "education" | "projects";

interface EntryDraft {
  headerLine: string;
  bodyLines: string[];
}

const isExperienceStyleSection = (sectionType: SectionType): sectionType is ExperienceStyleSection => {
  return sectionType === "experience" || sectionType === "volunteer" || sectionType === "education" || sectionType === "projects";
};

const hasStrongDateSignal = (line: string): boolean => {
  const dateRange = extractDateRangeFromText(line);
  return Boolean(dateRange.startDate && (dateRange.endDate || dateRange.currentRole));
};

const isHighConfidenceEntryHeader = (sectionType: ExperienceStyleSection, line: string): boolean => {
  if (findSectionByHeading(line) || hasContactSignal(line)) {
    return false;
  }

  if (/[.!?]$/.test(line)) {
    return false;
  }

  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 12) {
    return false;
  }

  if (sectionType === "experience" || sectionType === "volunteer") {
    const descriptor = normalizeWhitespaceText(extractDateRangeFromText(line).before || line);
    const split = splitRoleCompanyText(descriptor);
    if (split.role && split.company) {
      return true;
    }

    return /\b(?:intern|engineer|developer|analyst|manager|consultant|assistant|specialist|researcher|designer)\b/i.test(
      descriptor
    );
  }

  if (sectionType === "education") {
    return /(?:University|Institute|College|School|B\.?Sc|M\.?Sc|Bachelor|Master|Ph\.?D)/i.test(line);
  }

  return /\b(?:project|capstone|thesis|platform|system)\b/i.test(line) || /\s(?:\||\/|-|–|—)\s/.test(line);
};

const isStrongEntryBoundary = (sectionType: ExperienceStyleSection, line: string): boolean => {
  return hasStrongDateSignal(line) || isHighConfidenceEntryHeader(sectionType, line);
};

const inferEntryFields = (
  sectionType: ExperienceStyleSection,
  headerLine: string,
  bodyLines: string[]
): Record<string, unknown> => {
  const normalizedHeader = normalizeWhitespaceText(headerLine);
  const normalizedBody = normalizeWhitespaceText(bodyLines.join(" "));
  const combinedText = normalizeWhitespaceText([normalizedHeader, normalizedBody].filter(Boolean).join(" "));

  if (sectionType === "experience") {
    const headerDateParts = extractDateRangeFromText(normalizedHeader);
    const descriptor = normalizeWhitespaceText(headerDateParts.before || normalizedHeader);
    const split = splitRoleCompanyText(descriptor);
    const description = normalizeWhitespaceText([headerDateParts.after, normalizedBody].filter(Boolean).join(" "));

    return {
      role: split.role,
      company: split.company,
      start_date: headerDateParts.startDate,
      end_date: headerDateParts.endDate,
      current_role: headerDateParts.currentRole,
      description
    };
  }

  if (sectionType === "volunteer") {
    const experienceFields = inferEntryFields("experience", headerLine, bodyLines);
    const role = typeof experienceFields.role === "string" ? experienceFields.role : "";
    const company = typeof experienceFields.company === "string" ? experienceFields.company : "";
    const description = typeof experienceFields.description === "string" ? experienceFields.description : "";

    return {
      organization: company,
      role,
      location: "",
      start_date: experienceFields.start_date ?? "",
      end_date: experienceFields.end_date ?? "",
      current_role: experienceFields.current_role ?? false,
      description
    };
  }

  if (sectionType === "education") {
    return parseEducationFields(combinedText);
  }

  return parseProjectFields(combinedText);
};

const buildExperienceStyleBlocks = (sectionType: ExperienceStyleSection, lines: string[]): Array<Record<string, unknown>> => {
  const entries: EntryDraft[] = [];
  let current: EntryDraft | null = null;
  let bufferedBullets: string[] = [];
  let bufferedAmbiguous: string[] = [];

  const appendToCurrent = (line: string): void => {
    if (!current) {
      bufferedAmbiguous.push(line);
      return;
    }

    current.bodyLines.push(line);
  };

  const startNewEntry = (headerLine: string): void => {
    if (current) {
      entries.push(current);
    }

    current = {
      headerLine,
      bodyLines: [...bufferedAmbiguous, ...bufferedBullets]
    };

    bufferedAmbiguous = [];
    bufferedBullets = [];
  };

  for (const rawLine of lines) {
    const line = normalizeWhitespaceText(rawLine);
    if (!line) {
      continue;
    }

    const bullet = parseBulletItem(line);
    const normalizedLine = normalizeWhitespaceText(bullet ?? line);

    if (!normalizedLine) {
      continue;
    }

    if (isStrongEntryBoundary(sectionType, normalizedLine)) {
      startNewEntry(normalizedLine);
      continue;
    }

    if (bullet) {
      if (current) {
        const activeEntry = current as EntryDraft;
        activeEntry.bodyLines.push(normalizedLine);
      } else {
        bufferedBullets.push(normalizedLine);
      }
      continue;
    }

    appendToCurrent(normalizedLine);
  }

  if (current) {
    entries.push(current);
  }

  if (entries.length === 0) {
    const mergedText = normalizeWhitespaceText([...bufferedAmbiguous, ...bufferedBullets].join(" "));
    if (!mergedText) {
      return [];
    }

    return [
      {
        type: sectionType,
        fields: {
          text: mergedText,
          ...inferStructuredFields(sectionType, mergedText)
        },
        meta: {
          source: "import_parser"
        }
      }
    ];
  }

  if ((bufferedAmbiguous.length > 0 || bufferedBullets.length > 0) && entries.length > 0) {
    entries[entries.length - 1].bodyLines.push(...bufferedAmbiguous, ...bufferedBullets);
  }

  return entries.map((entry) => {
    const text = [entry.headerLine, ...entry.bodyLines]
      .map((line) => normalizeWhitespaceText(line))
      .filter((line) => line.length > 0)
      .join("\n");

    return {
      type: sectionType,
      fields: {
        text,
        ...inferEntryFields(sectionType, entry.headerLine, entry.bodyLines)
      },
      meta: {
        source: "import_parser"
      }
    };
  });
};

const buildGenericBlocks = (sectionType: SectionType, lines: string[]): Array<Record<string, unknown>> => {
  if (isExperienceStyleSection(sectionType)) {
    return buildExperienceStyleBlocks(sectionType, lines);
  }

  if (sectionType === "references" && lines.length > 0 && lines.length <= 4) {
    const mergedText = normalizeWhitespaceText(lines.join(" "));
    if (mergedText) {
      return [
        {
          type: sectionType,
          fields: {
            text: mergedText,
            ...inferStructuredFields(sectionType, mergedText)
          },
          meta: {
            source: "import_parser"
          }
        }
      ];
    }
  }

  const blocks: Array<Record<string, unknown>> = [];
  let itemBuffer: string[] = [];
  let textBuffer: string[] = [];

  const flushItems = () => {
    if (itemBuffer.length === 0) {
      return;
    }

    const items = dedupe(itemBuffer);
    blocks.push({
      type: `${sectionType}_items`,
      fields: {
        items,
        text: items.join("\n")
      },
      meta: {
        source: "import_parser"
      }
    });
    itemBuffer = [];
  };

  const flushText = () => {
    if (textBuffer.length === 0) {
      return;
    }

    const text = textBuffer.join("\n");
    blocks.push({
      type: sectionType,
      fields: {
        text,
        ...inferStructuredFields(sectionType, text)
      },
      meta: {
        source: "import_parser"
      }
    });
    textBuffer = [];
  };

  for (const line of lines) {
    const bullet = parseBulletItem(line);
    if (bullet) {
      flushText();
      itemBuffer.push(bullet);
      continue;
    }

    const delimited = splitDelimitedItems(line);
    if (delimited.length >= 3 && delimited.every((item) => item.split(/\s+/).length <= 5)) {
      flushText();
      itemBuffer.push(...delimited);
      continue;
    }

    if (textBuffer.length > 0 && /(?:\b(?:19|20)\d{2}\b)/.test(line) && (sectionType === "awards" || sectionType === "publications")) {
      flushItems();
      flushText();
    }

    flushItems();
    textBuffer.push(line);
  }

  flushItems();
  flushText();

  if (blocks.length === 0 && lines.length > 0) {
    blocks.push({
      type: sectionType,
      fields: {
        text: lines.join("\n")
      },
      meta: {
        source: "import_parser"
      }
    });
  }

  return blocks;
};

const toStructuredContent = (text: string): CvContent => {
  const language = "en" as const;
  const normalizedText = normalizeEmailSpacing(text);
  const lines = foldWrappedLines(toLines(normalizedText));

  const { buckets, headingCount } = segmentByHeadings(lines);

  const metadata = {
    full_name: extractName(lines) ?? "",
    headline: "",
    email: extractEmail(normalizedText, lines) ?? "",
    phone: extractPhone(normalizedText) ?? "",
    location: "",
    urls: getUrlCandidates(normalizedText)
  } as Record<string, unknown>;

  metadata.headline = extractHeadline(lines, (metadata.full_name as string) || null) ?? "";
  metadata.location = extractLocation(lines) ?? "";

  const headerBucketLines = dedupe(buckets.get("header") ?? []);
  const resolvedHeaderLines = buildHeaderLines(headerBucketLines, metadata);
  buckets.set("header", resolvedHeaderLines);

  const sections: Array<Record<string, unknown>> = [];

  for (const definition of SECTION_DEFINITIONS) {
    const sectionLines = dedupe(buckets.get(definition.type) ?? []);

    if (definition.type === "header") {
      const hasHeaderData =
        sectionLines.length > 0 ||
        Boolean(metadata.full_name) ||
        Boolean(metadata.email) ||
        Boolean(metadata.phone) ||
        Boolean(metadata.location) ||
        (Array.isArray(metadata.urls) && metadata.urls.length > 0);

      if (!hasHeaderData) {
        continue;
      }

      sections.push({
        type: definition.type,
        title: definition.title,
        blocks: [
          {
            type: "header",
            fields: {
              text: sectionLines.join("\n"),
              full_name: metadata.full_name,
              headline: metadata.headline,
              email: metadata.email,
              phone: metadata.phone,
              location: metadata.location,
              urls: metadata.urls
            },
            meta: {
              source: "import_parser"
            }
          }
        ],
        meta: {
          detection: headingCount > 0 ? "heading" : "fallback"
        }
      });

      continue;
    }

    if (sectionLines.length === 0) {
      continue;
    }

    if (definition.type === "summary") {
      const summaryText = sectionLines.join("\n");
      const summaryNormalized = normalizeWhitespaceText(summaryText).toLowerCase();
      const fullNameNormalized = normalizeWhitespaceText(String(metadata.full_name ?? "")).toLowerCase();

      if (summaryNormalized && fullNameNormalized && summaryNormalized === fullNameNormalized) {
        continue;
      }

      sections.push({
        type: definition.type,
        title: definition.title,
        blocks: [
          {
            type: "summary",
            fields: {
              text: summaryText
            },
            meta: {
              source: "import_parser"
            }
          }
        ],
        meta: {
          detection: headingCount > 0 ? "heading" : "fallback"
        }
      });

      continue;
    }

    if (definition.type === "skills") {
      const items = splitSkillItems(sectionLines);

      sections.push({
        type: definition.type,
        title: definition.title,
        blocks: [
          {
            type: "skills",
            fields: {
              items,
              text: sectionLines.join("\n")
            },
            meta: {
              source: "import_parser"
            }
          }
        ],
        meta: {
          detection: headingCount > 0 ? "heading" : "fallback"
        }
      });

      continue;
    }

    const blocks = buildGenericBlocks(definition.type, sectionLines);

    sections.push({
      type: definition.type,
      title: definition.title,
      blocks,
      meta: {
        detection: headingCount > 0 ? "heading" : "fallback"
      }
    });
  }

  if (sections.length === 0 && lines.length > 0) {
    sections.push({
      type: "summary",
      title: "Summary",
      blocks: [
        {
          type: "summary",
          fields: {
            text: lines.join("\n")
          },
          meta: {
            source: "import_parser"
          }
        }
      ],
      meta: {
        detection: "fallback"
      }
    });
  }

  return normalizeCvContent(
    {
      version: "v1",
      language,
      metadata,
      sections
    },
    language
  );
};

const createCandidate = (stage: ParserExtractionStage, text: string): ExtractedTextCandidate => {
  const cleanedText = cleanupExtractedText(text);
  const quality = evaluateTextQuality(cleanedText);

  return {
    stage,
    text,
    cleanedText,
    quality
  };
};

const selectBestCandidate = (candidates: ExtractedTextCandidate[]): ExtractedTextCandidate | null => {
  if (candidates.length === 0) {
    return null;
  }

  return [...candidates].sort((left, right) => {
    if (left.quality.score !== right.quality.score) {
      return right.quality.score - left.quality.score;
    }

    return right.cleanedText.length - left.cleanedText.length;
  })[0];
};

const selectBestPdfCandidate = (candidates: ExtractedTextCandidate[]): ExtractedTextCandidate | null => {
  if (candidates.length === 0) {
    return null;
  }

  const sorted = [...candidates].sort((left, right) => {
    if (left.quality.score !== right.quality.score) {
      return right.quality.score - left.quality.score;
    }

    return right.cleanedText.length - left.cleanedText.length;
  });

  const bestByStage = (stage: ParserExtractionStage): ExtractedTextCandidate | null =>
    sorted.find((candidate) => candidate.stage === stage) ?? null;

  const pdfJsCandidate = bestByStage("pdfjs_text");
  if (pdfJsCandidate) {
    const reliablePdfJs =
      !pdfJsCandidate.quality.lowConfidence ||
      (pdfJsCandidate.cleanedText.length >= 180 && pdfJsCandidate.quality.symbolRatio < 0.3);

    if (reliablePdfJs) {
      return pdfJsCandidate;
    }
  }

  const ocrCandidate = bestByStage("pdf_ocr_tesseract");
  if (ocrCandidate) {
    const reliableOcr =
      !ocrCandidate.quality.lowConfidence ||
      (ocrCandidate.cleanedText.length >= 220 && ocrCandidate.quality.symbolRatio < 0.28);

    if (reliableOcr) {
      return ocrCandidate;
    }
  }

  const tokenCandidate = bestByStage("pdf_token_heuristic");
  if (tokenCandidate && !tokenCandidate.quality.lowConfidence && tokenCandidate.cleanedText.length >= 160) {
    return tokenCandidate;
  }

  return pdfJsCandidate ?? ocrCandidate ?? tokenCandidate ?? sorted[0] ?? null;
};

const selectBestCandidateForKind = (
  kind: InputFileKind,
  candidates: ExtractedTextCandidate[]
): ExtractedTextCandidate | null => {
  if (kind === "pdf") {
    return selectBestPdfCandidate(candidates);
  }

  return selectBestCandidate(candidates);
};

const buildDiagnostics = (
  mimeType: string,
  attemptedStages: ParserExtractionStage[],
  finalCandidate: ExtractedTextCandidate
): ParseCvFileDiagnostics => {
  return {
    mime_type: mimeType,
    attempted_stages: attemptedStages,
    final_stage: finalCandidate.stage,
    quality: {
      score: finalCandidate.quality.score,
      confidence: finalCandidate.quality.confidence,
      low_confidence: finalCandidate.quality.lowConfidence,
      natural_language_ratio: round(finalCandidate.quality.naturalLanguageRatio),
      symbol_ratio: round(finalCandidate.quality.symbolRatio),
      repeated_token_ratio: round(finalCandidate.quality.repeatedTokenRatio),
      entropy_ratio: round(finalCandidate.quality.entropyRatio)
    }
  };
};

const maybeExtractRawText = async (
  input: ParseCvFileInput
): Promise<{
  rawText: string;
  warnings: string[];
  diagnostics: ParseCvFileDiagnostics;
  resolvedKind: InputFileKind;
}> => {
  const warnings: string[] = [];
  const mimeType = input.mimeType.toLowerCase();
  const resolvedKind = resolveInputFileKind(input);
  const safeBytes = new Uint8Array(input.bytes);

  const candidates: ExtractedTextCandidate[] = [];
  const attemptedStages: ParserExtractionStage[] = [];

  const registerCandidate = (stage: ParserExtractionStage, rawText: string): void => {
    const candidate = createCandidate(stage, rawText);
    if (candidate.cleanedText) {
      candidates.push(candidate);
    }
  };

  if (resolvedKind === "text") {
    attemptedStages.push("text_decode");
    registerCandidate("text_decode", decodeUtf8(safeBytes));
  } else if (resolvedKind === "docx") {
    attemptedStages.push("docx_xml_text");

    try {
      const docxText = await extractDocxTextWithXml(new Uint8Array(safeBytes));
      registerCandidate("docx_xml_text", docxText);
    } catch (error) {
      warnings.push(
        `DOCX XML extraction failed (${error instanceof Error ? error.message : "unknown error"}); trying UTF-8 fallback extraction.`
      );
    }

    const docxCandidate = candidates.find((candidate) => candidate.stage === "docx_xml_text") ?? null;
    if (!docxCandidate || docxCandidate.quality.lowConfidence || docxCandidate.cleanedText.length < 120) {
      attemptedStages.push("utf8_decode");
      registerCandidate("utf8_decode", decodeUtf8(safeBytes));
    }
  } else if (resolvedKind === "pdf") {
    attemptedStages.push("pdfjs_text");

    try {
      const pdfJsText = await extractPdfTextWithPdfJs(new Uint8Array(safeBytes));
      registerCandidate("pdfjs_text", pdfJsText);
    } catch (error) {
      warnings.push(
        `PDF.js extraction failed (${error instanceof Error ? error.message : "unknown error"}); trying fallback extractors.`
      );
    }

    const pdfJsCandidate = candidates.find((candidate) => candidate.stage === "pdfjs_text") ?? null;

    if (!pdfJsCandidate || pdfJsCandidate.quality.lowConfidence || pdfJsCandidate.cleanedText.length < 120) {
      attemptedStages.push("pdf_token_heuristic");
      registerCandidate("pdf_token_heuristic", extractPdfTextHeuristic(new Uint8Array(safeBytes)));
    }

    const bestSoFar = selectBestCandidateForKind("pdf", candidates);
    const shouldTryOcr =
      !bestSoFar ||
      bestSoFar.stage === "pdf_token_heuristic" ||
      bestSoFar.quality.lowConfidence ||
      bestSoFar.cleanedText.length < 180 ||
      bestSoFar.quality.symbolRatio > 0.25 ||
      bestSoFar.quality.naturalLanguageRatio < 0.55;

    if (shouldTryOcr && isPdfOcrEnabled()) {
      attemptedStages.push("pdf_ocr_tesseract");

      try {
        const ocrText = await extractPdfTextWithOcr(new Uint8Array(safeBytes));
        if (!ocrText.trim()) {
          warnings.push("PDF OCR completed but returned no readable text.");
        }
        registerCandidate("pdf_ocr_tesseract", ocrText);
      } catch (error) {
        warnings.push(
          `PDF OCR extraction failed (${error instanceof Error ? error.message : "unknown error"}); continuing with non-OCR fallbacks.`
        );
      }
    } else if (shouldTryOcr) {
      warnings.push("PDF OCR fallback is disabled; scanned/image-only PDFs may parse with lower quality.");
    }

    const bestAfterOcr = selectBestCandidateForKind("pdf", candidates);
    if (!bestAfterOcr || bestAfterOcr.quality.lowConfidence || bestAfterOcr.cleanedText.length < 120) {
      attemptedStages.push("utf8_decode");
      registerCandidate("utf8_decode", decodeUtf8(safeBytes));
    }
  } else {
    warnings.push(
      `MIME type '${input.mimeType}' is parsed with UTF-8 fallback extraction; results may be incomplete.`
    );
    attemptedStages.push("utf8_decode");
    registerCandidate("utf8_decode", decodeUtf8(safeBytes));
  }

  const finalCandidate =
    selectBestCandidateForKind(resolvedKind, candidates) ??
    createCandidate(
      attemptedStages[attemptedStages.length - 1] ?? "utf8_decode",
      decodeUtf8(safeBytes)
    );

  const diagnostics = buildDiagnostics(input.mimeType, attemptedStages, finalCandidate);

  if (resolvedKind === "pdf" && finalCandidate.stage !== "pdfjs_text") {
    warnings.push(
      `PDF.js extraction output was low-confidence or empty; final text came from '${finalCandidate.stage}'.`
    );
  }

  if (resolvedKind === "docx" && finalCandidate.stage !== "docx_xml_text") {
    warnings.push(
      `DOCX XML extraction output was low-confidence or empty; final text came from '${finalCandidate.stage}'.`
    );
  }

  const mimeKindMismatch =
    (resolvedKind === "pdf" && mimeType !== "application/pdf") ||
    (resolvedKind === "docx" && !docxMimeTypes.has(mimeType)) ||
    (resolvedKind === "text" && !(textMimeTypes.has(mimeType) || mimeType.startsWith("text/")));

  if (mimeKindMismatch) {
    warnings.push(`File type was auto-resolved as '${resolvedKind}' for parsing.`);
  }

  warnings.push(
    `Extraction diagnostics: final_stage=${diagnostics.final_stage}; attempted=${diagnostics.attempted_stages.join(" -> ")}; confidence=${diagnostics.quality.confidence}; score=${diagnostics.quality.score}.`
  );

  if (diagnostics.quality.low_confidence) {
    warnings.push(
      "Low-confidence extraction detected (symbol-heavy/repetitive text). Parsed result is returned for manual review."
    );
  } else if (diagnostics.quality.confidence === "medium") {
    warnings.push("Extraction confidence is medium. Review detected sections before conversion.");
  }

  if (!finalCandidate.cleanedText.trim()) {
    warnings.push("No readable text was extracted from the source file.");
  }

  return {
    rawText: finalCandidate.cleanedText,
    warnings,
    diagnostics,
    resolvedKind
  };
};

const parserNameForResolvedKind = (kind: InputFileKind): string => {
  if (kind === "pdf") {
    return "smart_pdf_parser_v2";
  }

  if (kind === "docx") {
    return "smart_docx_parser_v1";
  }

  return "simple_cv_parser_v1";
};

const asFieldText = (value: unknown): string => {
  if (typeof value === "string") {
    return normalizeWhitespaceText(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
};

const collectStructuredMappingWarnings = (parsedContent: CvContent): string[] => {
  const warnings: string[] = [];
  let partialExperienceCount = 0;
  let partialVolunteerCount = 0;

  for (const section of parsedContent.sections) {
    if (section.type !== "experience" && section.type !== "volunteer") {
      continue;
    }

    for (const block of section.blocks) {
      const role =
        section.type === "experience"
          ? asFieldText(block.fields.role)
          : asFieldText(block.fields.role);
      const organization =
        section.type === "experience"
          ? asFieldText(block.fields.company)
          : asFieldText(block.fields.organization);
      const hasDateSignal =
        asFieldText(block.fields.start_date).length > 0 ||
        asFieldText(block.fields.end_date).length > 0 ||
        block.fields.current_role === true;

      if (hasDateSignal && role && !organization) {
        if (section.type === "experience") {
          partialExperienceCount += 1;
        } else {
          partialVolunteerCount += 1;
        }
      }
    }
  }

  if (partialExperienceCount > 0) {
    warnings.push(
      `Some experience entries were only partially mapped (${partialExperienceCount} missing company values). Review Work Experience before conversion.`
    );
  }

  if (partialVolunteerCount > 0) {
    warnings.push(
      `Some volunteer entries were only partially mapped (${partialVolunteerCount} missing organization values). Review Volunteer Work before conversion.`
    );
  }

  return warnings;
};

export class SimpleCvParser implements CvParser {
  async extractRawText(input: ParseCvFileInput): Promise<ExtractCvRawTextResult> {
    const extracted = await maybeExtractRawText(input);
    const fallbackRaw = extracted.rawText || `${input.originalFilename}\n${input.mimeType}\n${input.sizeBytes}`;

    return {
      parserName: parserNameForResolvedKind(extracted.resolvedKind),
      rawExtractedText: fallbackRaw,
      warnings: extracted.warnings,
      diagnostics: extracted.diagnostics
    };
  }

  async parse(input: ParseCvFileInput): Promise<ParseCvFileResult> {
    const extracted = await this.extractRawText(input);
    const fallbackRaw = extracted.rawExtractedText;
    const parsedContent = toStructuredContent(fallbackRaw);
    const structuredWarnings = collectStructuredMappingWarnings(parsedContent);

    return {
      parserName: extracted.parserName,
      rawExtractedText: fallbackRaw,
      parsedContent,
      warnings: dedupe([...extracted.warnings, ...structuredWarnings]),
      diagnostics: extracted.diagnostics
    };
  }
}

export const __private = {
  cleanupExtractedText,
  evaluateTextQuality,
  resolveInputFileKind,
  extractTextFromWordXml,
  findSectionByHeading,
  classifyUnheadedLine,
  splitSkillItems,
  toStructuredContent
};

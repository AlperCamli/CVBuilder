import { normalizeCvContent } from "../../../shared/cv-content/cv-content.utils";
import type { CvContent } from "../../../shared/cv-content/cv-content.types";
import type { CvParser, ParseCvFileInput, ParseCvFileResult } from "./cv-parser";

interface SectionDefinition {
  type: "summary" | "experience" | "education" | "skills" | "projects";
  titleEn: string;
  titleTr: string;
  patterns: RegExp[];
}

const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    type: "summary",
    titleEn: "Summary",
    titleTr: "Özet",
    patterns: [/^summary$/i, /^profile$/i, /^objective$/i, /^about$/i, /^özet$/i, /^hakk[ıi]mda$/i]
  },
  {
    type: "experience",
    titleEn: "Experience",
    titleTr: "Deneyim",
    patterns: [/^experience$/i, /^work experience$/i, /^employment$/i, /^deneyim$/i, /^iş deneyimi$/i]
  },
  {
    type: "education",
    titleEn: "Education",
    titleTr: "Eğitim",
    patterns: [/^education$/i, /^academic background$/i, /^eğitim$/i]
  },
  {
    type: "skills",
    titleEn: "Skills",
    titleTr: "Yetenekler",
    patterns: [/^skills$/i, /^technical skills$/i, /^competencies$/i, /^yetenekler$/i, /^beceriler$/i]
  },
  {
    type: "projects",
    titleEn: "Projects",
    titleTr: "Projeler",
    patterns: [/^projects$/i, /^project experience$/i, /^projeler$/i]
  }
];

const textMimeTypes = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
  "application/xml",
  "text/html"
]);

const decodeUtf8 = (bytes: Uint8Array): string => {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  return decoder.decode(bytes);
};

const sanitizeText = (value: string): string => {
  return value
    .replace(/\u0000/g, " ")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const decodePdfStringToken = (token: string): string => {
  const withoutParens = token.slice(1, -1);

  return withoutParens
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
};

const extractPdfTextHeuristic = (bytes: Uint8Array): string => {
  const binary = Buffer.from(bytes).toString("latin1");
  const matches = binary.match(/\((?:\\.|[^\\()])+\)/g) ?? [];

  if (matches.length === 0) {
    return "";
  }

  return matches.slice(0, 10000).map((token) => decodePdfStringToken(token)).join("\n");
};

const detectLanguage = (text: string): "tr" | "en" => {
  if (/[ığüşöçİĞÜŞÖÇ]/.test(text)) {
    return "tr";
  }

  if (/\b(deneyim|eğitim|yetenek|hakkımda|özgeçmiş)\b/i.test(text)) {
    return "tr";
  }

  return "en";
};

const toLines = (text: string): string[] => {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const findSectionByHeading = (line: string): SectionDefinition | null => {
  const candidate = line.replace(/[:\-–]+$/, "").trim();

  for (const definition of SECTION_DEFINITIONS) {
    if (definition.patterns.some((pattern) => pattern.test(candidate))) {
      return definition;
    }
  }

  return null;
};

const dedupe = (items: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of items) {
    const key = item.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(item);
  }

  return output;
};

const extractName = (lines: string[]): string | null => {
  const candidate = lines.find((line) => {
    if (line.length < 3 || line.length > 80) {
      return false;
    }

    if (/@/.test(line) || /\d/.test(line)) {
      return false;
    }

    if (/experience|education|skills|summary|deneyim|eğitim|yetenek/i.test(line)) {
      return false;
    }

    return true;
  });

  return candidate ?? null;
};

const extractEmail = (text: string): string | null => {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
};

const extractPhone = (text: string): string | null => {
  const match = text.match(/\+?\d[\d\s().-]{6,}\d/);
  return match ? match[0].trim() : null;
};

const splitSkillItems = (lines: string[]): string[] => {
  return dedupe(
    lines
      .flatMap((line) => line.split(/[;,•·|]/g))
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  );
};

const toStructuredContent = (text: string): CvContent => {
  const language = detectLanguage(text);
  const lines = toLines(text);

  const buckets = new Map<SectionDefinition["type"], string[]>();
  let activeSection: SectionDefinition["type"] = "summary";

  for (const line of lines) {
    const sectionFromHeading = findSectionByHeading(line);

    if (sectionFromHeading) {
      activeSection = sectionFromHeading.type;
      continue;
    }

    const existing = buckets.get(activeSection) ?? [];
    buckets.set(activeSection, [...existing, line]);
  }

  const sections: Array<Record<string, unknown>> = [];

  for (const definition of SECTION_DEFINITIONS) {
    const sectionLines = buckets.get(definition.type) ?? [];

    if (sectionLines.length === 0) {
      continue;
    }

    if (definition.type === "skills") {
      const items = splitSkillItems(sectionLines);

      sections.push({
        type: definition.type,
        title: language === "tr" ? definition.titleTr : definition.titleEn,
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
        ]
      });

      continue;
    }

    if (definition.type === "summary") {
      sections.push({
        type: definition.type,
        title: language === "tr" ? definition.titleTr : definition.titleEn,
        blocks: [
          {
            type: "summary",
            fields: {
              text: sectionLines.join("\n")
            },
            meta: {
              source: "import_parser"
            }
          }
        ]
      });

      continue;
    }

    sections.push({
      type: definition.type,
      title: language === "tr" ? definition.titleTr : definition.titleEn,
      blocks: sectionLines.map((line) => ({
        type: definition.type,
        fields: {
          text: line
        },
        meta: {
          source: "import_parser"
        }
      }))
    });
  }

  if (sections.length === 0 && lines.length > 0) {
    sections.push({
      type: "summary",
      title: language === "tr" ? "Özet" : "Summary",
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
      ]
    });
  }

  return normalizeCvContent(
    {
      version: "v1",
      language,
      metadata: {
        full_name: extractName(lines) ?? "",
        email: extractEmail(text) ?? "",
        phone: extractPhone(text) ?? ""
      },
      sections
    },
    language
  );
};

const maybeExtractRawText = (input: ParseCvFileInput): { rawText: string; warnings: string[] } => {
  const warnings: string[] = [];
  const mimeType = input.mimeType.toLowerCase();

  let rawText = "";

  if (textMimeTypes.has(mimeType) || mimeType.startsWith("text/")) {
    rawText = decodeUtf8(input.bytes);
  } else if (mimeType === "application/pdf") {
    rawText = extractPdfTextHeuristic(input.bytes);

    if (!rawText.trim()) {
      warnings.push("PDF text extraction fallback used; extracted content may be incomplete.");
      rawText = decodeUtf8(input.bytes);
    }
  } else {
    warnings.push(
      `MIME type '${input.mimeType}' is parsed with fallback text extraction; results may be incomplete.`
    );
    rawText = decodeUtf8(input.bytes);
  }

  const sanitized = sanitizeText(rawText);

  if (!sanitized) {
    warnings.push("No readable text was extracted from the source file.");
  }

  return {
    rawText: sanitized,
    warnings
  };
};

export class SimpleCvParser implements CvParser {
  async parse(input: ParseCvFileInput): Promise<ParseCvFileResult> {
    const extracted = maybeExtractRawText(input);

    const fallbackRaw = extracted.rawText || `${input.originalFilename}\n${input.mimeType}\n${input.sizeBytes}`;
    const parsedContent = toStructuredContent(fallbackRaw);

    return {
      parserName: "simple_cv_parser_v1",
      rawExtractedText: fallbackRaw,
      parsedContent,
      warnings: extracted.warnings
    };
  }
}

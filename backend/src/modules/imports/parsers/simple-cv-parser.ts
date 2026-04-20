import { extname } from "node:path";
import JSZip from "jszip";
import { normalizeCvContent } from "../../../shared/cv-content/cv-content.utils";
import type { CvContent } from "../../../shared/cv-content/cv-content.types";
import type {
  CvParser,
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
  titleEn: string;
  titleTr: string;
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
    titleEn: "Header",
    titleTr: "Başlık",
    aliases: [
      "header",
      "contact",
      "contact info",
      "contact information",
      "personal information",
      "iletişim",
      "iletişim bilgileri",
      "kişisel bilgiler",
      "profil bilgileri"
    ],
    keywords: [
      "contact",
      "email",
      "phone",
      "linkedin",
      "github",
      "portfolio",
      "address",
      "iletisim",
      "eposta",
      "telefon",
      "adres"
    ]
  },
  {
    type: "summary",
    titleEn: "Summary",
    titleTr: "Özet",
    aliases: [
      "summary",
      "profile",
      "professional summary",
      "objective",
      "about",
      "about me",
      "özet",
      "profil",
      "hakkımda",
      "kariyer özeti"
    ],
    keywords: ["summary", "profile", "objective", "about", "ozet", "hakkimda"]
  },
  {
    type: "experience",
    titleEn: "Experience",
    titleTr: "Deneyim",
    aliases: [
      "experience",
      "experiences",
      "experiences and programs",
      "work experience",
      "professional experience",
      "employment",
      "career history",
      "deneyim",
      "iş deneyimi",
      "çalışma deneyimi",
      "tecrübe"
    ],
    keywords: [
      "experience",
      "employment",
      "worked",
      "position",
      "role",
      "deneyim",
      "calistim",
      "gorev"
    ]
  },
  {
    type: "education",
    titleEn: "Education",
    titleTr: "Eğitim",
    aliases: [
      "education",
      "academic background",
      "academics",
      "education background",
      "eğitim",
      "öğrenim",
      "akademik geçmiş"
    ],
    keywords: [
      "education",
      "university",
      "college",
      "bachelor",
      "master",
      "phd",
      "egitim",
      "universite",
      "lisans",
      "yuksek lisans"
    ]
  },
  {
    type: "skills",
    titleEn: "Skills",
    titleTr: "Yetenekler",
    aliases: [
      "skills",
      "technical skills",
      "core skills",
      "competencies",
      "technologies",
      "yetenekler",
      "beceriler",
      "teknik yetkinlikler",
      "uzmanlıklar"
    ],
    keywords: [
      "skills",
      "competencies",
      "technology",
      "tech stack",
      "tools",
      "yetenek",
      "beceri",
      "teknoloji",
      "yetkinlik"
    ]
  },
  {
    type: "languages",
    titleEn: "Languages",
    titleTr: "Diller",
    aliases: ["languages", "language skills", "language", "diller", "dil becerileri", "yabancı diller"],
    keywords: [
      "language",
      "languages",
      "english",
      "turkish",
      "native",
      "fluent",
      "dil",
      "ingilizce",
      "turkce",
      "ana dil"
    ]
  },
  {
    type: "certifications",
    titleEn: "Certifications",
    titleTr: "Sertifikalar",
    aliases: ["certifications", "certificates", "licenses", "sertifikalar", "sertifika", "belgeler"],
    keywords: [
      "certification",
      "certificate",
      "licensed",
      "credential",
      "sertifika",
      "belge",
      "lisans"
    ]
  },
  {
    type: "courses",
    titleEn: "Courses",
    titleTr: "Kurslar",
    aliases: ["courses", "coursework", "trainings", "training", "kurslar", "eğitimler", "dersler"],
    keywords: ["course", "training", "bootcamp", "kurs", "egitim", "ders"]
  },
  {
    type: "projects",
    titleEn: "Projects",
    titleTr: "Projeler",
    aliases: ["projects", "project experience", "selected projects", "projeler", "proje deneyimi"],
    keywords: ["project", "portfolio", "github", "repo", "proje"]
  },
  {
    type: "volunteer",
    titleEn: "Volunteer",
    titleTr: "Gönüllülük",
    aliases: ["volunteer", "volunteering", "volunteer experience", "community service", "gönüllülük", "gönüllü çalışmalar"],
    keywords: ["volunteer", "community", "ngo", "mentorship", "gonullu", "topluluk", "sivil toplum"]
  },
  {
    type: "awards",
    titleEn: "Awards",
    titleTr: "Ödüller",
    aliases: ["awards", "honors", "achievements", "ödüller", "başarılar", "onur ödülleri"],
    keywords: ["award", "honor", "achievement", "odul", "basari", "onur"]
  },
  {
    type: "publications",
    titleEn: "Publications",
    titleTr: "Yayınlar",
    aliases: ["publications", "papers", "research", "yayınlar", "makaleler", "bildiriler"],
    keywords: ["publication", "paper", "journal", "conference", "yayin", "makale", "bildiri"]
  },
  {
    type: "references",
    titleEn: "References",
    titleTr: "Referanslar",
    aliases: ["references", "referees", "referanslar", "referans"],
    keywords: ["reference", "referee", "referans"]
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
  "turkiye",
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

const hasContactSignal = (line: string): boolean => {
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(line)) {
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
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as {
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

const findSectionByHeading = (line: string): SectionDefinition | null => {
  if (!looksLikeHeading(line)) {
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
      if (aliasFolded && normalized.includes(aliasFolded) && normalized.split(" ").length <= 6) {
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

  return /\b(?:bsc|msc|ba|ma|phd|associate|yüksek lisans|lisans|ön lisans|universite|üniversite)\b/i.test(
    line
  );
};

const isLikelyExperienceLine = (line: string): boolean => {
  if (containsAnyKeyword(line, SECTION_DEFINITION_BY_TYPE.get("experience")?.keywords ?? [])) {
    return true;
  }

  const hasYear = /\b(?:19|20)\d{2}\b/.test(line);
  const hasRangeConnector = /(?:-|–|—|to|present|halen|devam)/i.test(line);

  return hasYear && hasRangeConnector;
};

const classifyUnheadedLine = (line: string): SectionType => {
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

const detectLanguage = (text: string): "tr" | "en" => {
  if (/[ığüşöçİĞÜŞÖÇ]/.test(text)) {
    return "tr";
  }

  const folded = normalizeFolded(text);
  const trSignals =
    folded.match(/\b(deneyim|egitim|yetenek|beceri|hakkimda|ozet|gonullu|referans|sertifika)\b/g)
      ?.length ?? 0;
  const enSignals =
    folded.match(/\b(experience|education|skills|summary|profile|projects|references|certifications)\b/g)
      ?.length ?? 0;

  return trSignals > enSignals ? "tr" : "en";
};

const extractName = (lines: string[]): string | null => {
  const topLines = lines.slice(0, 12);

  for (const line of topLines) {
    if (hasContactSignal(line) || findSectionByHeading(line)) {
      continue;
    }

    if (line.length < 3 || line.length > 80) {
      continue;
    }

    if (/\d/.test(line)) {
      continue;
    }

    const words = line.split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 6) {
      continue;
    }

    if (words.some((word) => word.length <= 1)) {
      continue;
    }

    return line;
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

    if (/\b(?:summary|experience|education|skills|projects|özet|deneyim|eğitim|yetenekler)\b/i.test(line)) {
      continue;
    }

    if (/^(?:başlık|baslik|title|heading)$/i.test(line.trim())) {
      continue;
    }

    if (/\b(?:contact information|birth date|language skills|english|spanish|turkish)\b/i.test(line)) {
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

const extractEmail = (text: string): string | null => {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
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

    if (/\b(member|intern|engineer|consultant|assistant|advisor|stajyer|muhendis|uzman)\b/i.test(line)) {
      continue;
    }

    if (/\b(university|universite|üniversite|student|öğrenci|engineering|muhendis)\b/i.test(line)) {
      continue;
    }

    if (/\b(language|english|spanish|turkish|native|advanced|beginner)\b/i.test(line)) {
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
  "dec(?:ember)?",
  "ocak",
  "şubat",
  "subat",
  "mart",
  "nisan",
  "mayıs",
  "mayis",
  "haziran",
  "temmuz",
  "ağustos",
  "agustos",
  "eyl[üu]l",
  "ekim",
  "kas[ıi]m",
  "aral[ıi]k"
].join("|");

const dateTokenPattern = `(?:${monthTokenPattern})\\s+\\d{4}|\\d{1,2}[./-]\\d{4}|\\d{4}`;
const dateRangePattern = new RegExp(
  `(${dateTokenPattern})\\s*(?:-|–|—|to)\\s*(present|current|now|halen|devam|${dateTokenPattern})`,
  "i"
);

const normalizeDateToken = (value: string): string => {
  const normalized = normalizeWhitespaceText(value.replace(/[()]/g, ""));
  if (/^(present|current|now|halen|devam)$/i.test(normalized)) {
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

const splitRoleCompanyText = (value: string): { role: string; company: string } => {
  const text = normalizeWhitespaceText(value);
  if (!text) {
    return { role: "", company: "" };
  }

  const atMatch = text.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (atMatch) {
    return {
      role: normalizeWhitespaceText(atMatch[1]),
      company: normalizeWhitespaceText(atMatch[2])
    };
  }

  const separatorMatch = text.match(/^(.+?)\s*[-–—|/]\s*(.+)$/);
  if (separatorMatch) {
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
  const roleCompany = splitRoleCompanyText(dateParts.before || text);
  const description = normalizeWhitespaceText(dateParts.after || text);

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

  return {
    organization: company,
    role,
    location: "",
    start_date: experience.start_date ?? "",
    end_date: experience.end_date ?? "",
    current_role: experience.current_role ?? false,
    description: experience.description ?? rawText
  };
};

const parseEducationFields = (rawText: string): Record<string, unknown> => {
  const text = normalizeWhitespaceText(rawText);
  if (!text) {
    return {};
  }

  const dateParts = extractDateRangeFromText(text);
  const gpaMatch = text.match(/\bGPA[:\s]*([0-9]+(?:[.,][0-9]+)?(?:\s*\/\s*[0-9]+(?:[.,][0-9]+)?)?)/i);
  const expectedMatch = text.match(/(?:Expected|Beklenen)\s+([A-Za-zÇĞİÖŞÜçğıöşü0-9./-]+\s*\d{0,4})/i);
  const institutionMatch = text.match(
    /([A-Za-zÇĞİÖŞÜçğıöşü0-9&.\- ]+(?:University|Üniversite|Institute|College|School|Technical))/i
  );
  const degreeMatch = text.match(
    /\b(?:B\.?Sc|M\.?Sc|Ph\.?D|Bachelor|Master|Lisans|Yüksek Lisans|Associate|Ön Lisans)\b[^|,;)]*/i
  );
  const fieldMatch = text.match(
    /([A-Za-zÇĞİÖŞÜçğıöşü\s]+(?:Engineering|Mühendislik|Management|Yönetim|Design|Science|Business))/i
  );

  const expectedGraduation = /(?:expected|beklenen)/i.test(text);
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
  const text = normalizeWhitespaceText(rawText.replace(/^(?:lar|references?)\s*/i, ""));
  if (!text) {
    return {};
  }

  const allPhoneMatches = [...text.matchAll(/\+?\d[\d\s().-]{7,}\d/g)];
  const allEmailMatches = [...text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)];
  if (allPhoneMatches.length > 1 || allEmailMatches.length > 1) {
    return {};
  }

  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = text.match(/\+?\d[\d\s().-]{7,}\d/);
  const withoutEmail = normalizeWhitespaceText(emailMatch ? text.replace(emailMatch[0], " ") : text);
  const withoutPhone = normalizeWhitespaceText(phoneMatch ? withoutEmail.replace(phoneMatch[0], " ") : withoutEmail);
  const slashParts = withoutPhone.split("/");
  const name = normalizeWhitespaceText(slashParts[0] ?? "");
  const roleOrg = normalizeWhitespaceText(slashParts.slice(1).join("/"));
  const roleOrgMatch = roleOrg.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);

  return {
    name,
    job_title: normalizeWhitespaceText(roleOrgMatch?.[1] ?? roleOrg),
    organization: normalizeWhitespaceText(roleOrgMatch?.[2] ?? ""),
    email: emailMatch?.[0] ?? "",
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

const buildGenericBlocks = (sectionType: SectionType, lines: string[]): Array<Record<string, unknown>> => {
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

    flushItems();
    textBuffer.push(line);

    if (line.length > 140 || /[.!?]$/.test(line)) {
      flushText();
    }
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
  const language = detectLanguage(text);
  const lines = toLines(text);

  const { buckets, headingCount } = segmentByHeadings(lines);

  const metadata = {
    full_name: extractName(lines) ?? "",
    headline: "",
    email: extractEmail(text) ?? "",
    phone: extractPhone(text) ?? "",
    location: "",
    urls: getUrlCandidates(text)
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
        title: language === "tr" ? definition.titleTr : definition.titleEn,
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
      title: language === "tr" ? definition.titleTr : definition.titleEn,
      blocks,
      meta: {
        detection: headingCount > 0 ? "heading" : "fallback"
      }
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

    const bestSoFar = selectBestCandidate(candidates);
    if (!bestSoFar || bestSoFar.quality.lowConfidence || bestSoFar.cleanedText.length < 120) {
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
    selectBestCandidate(candidates) ??
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

export class SimpleCvParser implements CvParser {
  async parse(input: ParseCvFileInput): Promise<ParseCvFileResult> {
    const extracted = await maybeExtractRawText(input);

    const fallbackRaw = extracted.rawText || `${input.originalFilename}\n${input.mimeType}\n${input.sizeBytes}`;
    const parsedContent = toStructuredContent(fallbackRaw);

    return {
      parserName: parserNameForResolvedKind(extracted.resolvedKind),
      rawExtractedText: fallbackRaw,
      parsedContent,
      warnings: extracted.warnings,
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

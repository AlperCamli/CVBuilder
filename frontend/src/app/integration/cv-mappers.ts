import type { CvBlock, CvContent, CvJsonValue, CvSection, CvVisibility } from "./api-types";

export interface EditorHeaderData {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  photo?: string | null;
  socialLinks: Array<{ id: string; type: string; url: string }>;
}

export interface EditorSection {
  id: string;
  type: string;
  hidden: boolean;
  data: Record<string, unknown>;
  backendSectionId?: string;
  order: number;
}

interface EditorItem {
  id: string;
  blockId?: string;
  blockType?: string;
  hidden?: boolean;
  rawFields?: Record<string, CvJsonValue>;
  rawMeta?: Record<string, CvJsonValue>;
  [key: string]: unknown;
}

const randomId = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const asString = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
};

const asBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "yes" || normalized === "1";
  }

  if (typeof value === "number") {
    return value === 1;
  }

  return false;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => asString(item).trim())
    .filter((item) => item.length > 0);
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
  const handleMatches = value.match(/\b(?:linkedin|github|gitlab|behance|dribbble|medium|in)\/[A-Za-z0-9._-]{2,}\b/gi) ?? [];

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

const flattenText = (value: unknown): string[] => {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenText(item));
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap((item) => flattenText(item));
  }

  return [];
};

const getField = (block: CvBlock, ...keys: string[]): string => {
  for (const key of keys) {
    if (key in block.fields) {
      const text = flattenText(block.fields[key]);
      if (text.length > 0) {
        return text.join(", ");
      }
    }
  }

  return "";
};

const buildDates = (start: string, end: string): string => {
  if (!start && !end) {
    return "";
  }

  if (start && end) {
    return `${start} - ${end}`;
  }

  return start || end;
};

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const firstNonEmpty = (...values: string[]): string => {
  for (const value of values) {
    const normalized = normalizeWhitespace(value);
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return "";
};

const isYearOnly = (value: string): boolean => /^(?:19|20)\d{2}$/.test(normalizeWhitespace(value));

const monthPattern = [
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

const dateTokenPattern = `(?:${monthPattern})\\s+\\d{4}|\\d{1,2}[./-]\\d{4}|\\d{4}`;
const dateRangeRegex = new RegExp(
  `(${dateTokenPattern})\\s*(?:-|–|—|to)\\s*(present|current|now|halen|devam|${dateTokenPattern})`,
  "i"
);

const normalizeDateValue = (value: string): string => {
  const normalized = normalizeWhitespace(value.replace(/[()]/g, ""));
  if (/^(present|current|now|halen|devam)$/i.test(normalized)) {
    return "Present";
  }

  return normalized;
};

const extractDateRange = (
  rawText: string
): { startDate: string; endDate: string; currentRole: boolean; before: string; after: string } => {
  const text = normalizeWhitespace(rawText);
  const match = dateRangeRegex.exec(text);

  if (!match || match.index === undefined) {
    return {
      startDate: "",
      endDate: "",
      currentRole: false,
      before: text,
      after: ""
    };
  }

  const startDate = normalizeDateValue(match[1]);
  const endDate = normalizeDateValue(match[2]);
  const currentRole = endDate.toLowerCase() === "present";

  return {
    startDate,
    endDate,
    currentRole,
    before: normalizeWhitespace(text.slice(0, match.index)),
    after: normalizeWhitespace(text.slice(match.index + match[0].length))
  };
};

const parseRoleCompany = (rawText: string): { role: string; company: string } => {
  const text = normalizeWhitespace(rawText);
  if (!text) {
    return { role: "", company: "" };
  }

  const atMatch = text.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (atMatch) {
    return {
      role: normalizeWhitespace(atMatch[1]),
      company: normalizeWhitespace(atMatch[2])
    };
  }

  const commaParts = text.split(",").map((part) => normalizeWhitespace(part)).filter((part) => part.length > 0);
  if (
    commaParts.length === 2 &&
    commaParts[0].split(/\s+/).length <= 8 &&
    commaParts[1].split(/\s+/).length <= 8 &&
    !/[.;!?]/.test(commaParts[0]) &&
    !/[.;!?]/.test(commaParts[1])
  ) {
    return {
      role: commaParts[0],
      company: commaParts[1]
    };
  }

  const separatorMatch = text.match(/^(.+?)\s(?:\||\/|-|–|—)\s(.+)$/);
  if (
    separatorMatch &&
    !/[.;!?]/.test(separatorMatch[1]) &&
    !/[.;!?]/.test(separatorMatch[2]) &&
    separatorMatch[1].split(/\s+/).length <= 8 &&
    separatorMatch[2].split(/\s+/).length <= 8
  ) {
    return {
      role: normalizeWhitespace(separatorMatch[1]),
      company: normalizeWhitespace(separatorMatch[2])
    };
  }

  return { role: text, company: "" };
};

const extractLeadPhrase = (rawText: string): string => {
  const text = normalizeWhitespace(rawText);
  if (!text) {
    return "";
  }

  const words = text.split(" ");
  const descriptionStartWords = new Set([
    "Contributing",
    "Learned",
    "Working",
    "Worked",
    "Assisted",
    "Produced",
    "Actively",
    "During",
    "Managed",
    "Responsible",
    "Leading",
    "Led",
    "Supported",
    "Supporting",
    "Provided",
    "Developed",
    "Created",
    "Improved"
  ]);

  for (let index = 1; index < words.length; index += 1) {
    if (descriptionStartWords.has(words[index])) {
      return words.slice(0, index).join(" ");
    }
  }

  if (words.length > 8) {
    return words.slice(0, 8).join(" ");
  }

  return text;
};

const parseExperienceText = (rawText: string): {
  role: string;
  company: string;
  startDate: string;
  endDate: string;
  currentRole: boolean;
  description: string;
} => {
  const text = normalizeWhitespace(rawText);
  if (!text) {
    return {
      role: "",
      company: "",
      startDate: "",
      endDate: "",
      currentRole: false,
      description: ""
    };
  }

  const dateParts = extractDateRange(text);
  let descriptor = dateParts.before;
  let description = dateParts.after;

  if (!descriptor && description) {
    const lead = extractLeadPhrase(description);
    descriptor = lead;
    if (lead && description.toLowerCase().startsWith(lead.toLowerCase())) {
      description = normalizeWhitespace(description.slice(lead.length));
    }
  }

  const roleCompany = parseRoleCompany(descriptor);

  if (!description && descriptor && text.toLowerCase().startsWith(descriptor.toLowerCase())) {
    description = normalizeWhitespace(text.slice(descriptor.length));
  }

  return {
    role: roleCompany.role,
    company: roleCompany.company,
    startDate: dateParts.startDate,
    endDate: dateParts.endDate,
    currentRole: dateParts.currentRole,
    description: description || text
  };
};

const splitOrganizationRole = (rawText: string): { organization: string; role: string } => {
  const text = normalizeWhitespace(rawText);
  if (!text) {
    return { organization: "", role: "" };
  }

  const atMatch = text.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (atMatch) {
    return {
      role: normalizeWhitespace(atMatch[1]),
      organization: normalizeWhitespace(atMatch[2])
    };
  }

  const words = text.split(" ");
  if (words.length <= 3) {
    return { organization: "", role: text };
  }

  const roleWordCount = words.length <= 5 ? 2 : 3;
  return {
    organization: words.slice(0, -roleWordCount).join(" "),
    role: words.slice(-roleWordCount).join(" ")
  };
};

const parseVolunteerText = (rawText: string): {
  organization: string;
  role: string;
  startDate: string;
  endDate: string;
  currentRole: boolean;
  description: string;
} => {
  const parsed = parseExperienceText(rawText);
  if (parsed.company) {
    return {
      organization: parsed.company,
      role: parsed.role,
      startDate: parsed.startDate,
      endDate: parsed.endDate,
      currentRole: parsed.currentRole,
      description: parsed.description
    };
  }

  const split = splitOrganizationRole(parsed.role);
  return {
    organization: split.organization,
    role: split.role || parsed.role,
    startDate: parsed.startDate,
    endDate: parsed.endDate,
    currentRole: parsed.currentRole,
    description: parsed.description
  };
};

const parseEducationText = (rawText: string): {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  gpa: string;
  startDate: string;
  endDate: string;
  description: string;
} => {
  const text = normalizeWhitespace(rawText);
  if (!text) {
    return {
      institution: "",
      degree: "",
      fieldOfStudy: "",
      gpa: "",
      startDate: "",
      endDate: "",
      description: ""
    };
  }

  const dateParts = extractDateRange(text);
  const gpaMatch = text.match(/\bGPA[:\s]*([0-9]+(?:[.,][0-9]+)?(?:\s*\/\s*[0-9]+(?:[.,][0-9]+)?)?)/i);
  const expectedMatch = text.match(/(?:Expected|Beklenen)\s+([A-Za-zÇĞİÖŞÜçğıöşü0-9./-]+\s*\d{0,4})/i);
  const atMatch = text.match(/(?:at|@)\s+([^|,()]+)/i);

  const segments = text
    .split("|")
    .map((segment) =>
      normalizeWhitespace(segment).replace(/^(başlık|title|heading)\s*/i, "").trim()
    )
    .filter((segment) => segment.length > 0);

  const degree =
    firstNonEmpty(
      ...segments.filter((segment) =>
        /(B\.?Sc|M\.?Sc|Ph\.?D|Bachelor|Master|Lisans|Yüksek)/i.test(
          segment
        )
      ),
      ...segments.filter((segment) => /(Candidate|Student|Öğrenci)/i.test(segment)),
      segments[0] || ""
    ) || "";

  const institutionFromDegreeSegment = segments
    .map((segment) => segment.match(/,\s*([^,(]+(?:University|Üniversite|Institute|College|School|Technical)[^,(]*)/i)?.[1] || "")
    .find((segment) => segment.trim().length > 0);

  const institution = firstNonEmpty(
    institutionFromDegreeSegment || "",
    atMatch?.[1] || "",
    ...segments.filter((segment) =>
      /(University|Üniversite|Institute|College|School|Technical)/i.test(segment)
    )
  );

  const fieldOfStudy = firstNonEmpty(
    ...segments.filter((segment) =>
      /(Engineering|Management|Computer|Business|Science|Design|Mühendislik|Yönetim)/i.test(
        segment
      )
    )
  );

  const endDate = firstNonEmpty(dateParts.endDate, expectedMatch?.[1] || "");
  const fieldOfStudyMatch = text.match(
    /([A-Za-zÇĞİÖŞÜçğıöşü\s]+(?:Engineering|Mühendislik|Management|Yönetim|Design|Science|Business))/i
  );

  return {
    institution,
    degree,
    fieldOfStudy: firstNonEmpty(fieldOfStudy, fieldOfStudyMatch?.[1] || ""),
    gpa: gpaMatch ? normalizeWhitespace(gpaMatch[1]) : "",
    startDate: dateParts.startDate,
    endDate,
    description: text.replace(/^(başlık|title|heading)\s*/i, "").trim()
  };
};

const parseLanguageItems = (
  rawText: string
): Array<{ language: string; proficiency: string; certificate: string; notes: string }> => {
  const text = normalizeWhitespace(rawText);
  if (!text) {
    return [];
  }

  return text
    .split(/[,;\n]+/)
    .map((part) => normalizeWhitespace(part))
    .filter((part) => part.length > 0)
    .map((part) => {
      const bracketMatch = part.match(/^(.+?)\s*\(([^)]+)\)$/);
      if (bracketMatch) {
        return {
          language: normalizeWhitespace(bracketMatch[1]),
          proficiency: normalizeWhitespace(bracketMatch[2]),
          certificate: "",
          notes: ""
        };
      }

      const separatorMatch = part.match(/^(.+?)\s*[-–—:]\s*(.+)$/);
      if (separatorMatch) {
        return {
          language: normalizeWhitespace(separatorMatch[1]),
          proficiency: normalizeWhitespace(separatorMatch[2]),
          certificate: "",
          notes: ""
        };
      }

      return {
        language: part,
        proficiency: "",
        certificate: "",
        notes: ""
      };
    });
};

const parseReferenceItems = (rawText: string): Array<{
  name: string;
  jobTitle: string;
  organization: string;
  email: string;
  phone: string;
}> => {
  const text = normalizeWhitespace(rawText);
  if (!text) {
    return [];
  }

  const phoneRegex = /\+?\d[\d\s().-]{7,}\d/g;
  const phoneMatches = [...text.matchAll(phoneRegex)];

  const parseChunk = (chunkText: string): {
    name: string;
    jobTitle: string;
    organization: string;
    email: string;
    phone: string;
  } => {
    const cleaned = normalizeWhitespace(chunkText.replace(/^(?:lar|references?)\s*/i, ""));
    const emailMatch = cleaned.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const email = emailMatch?.[0] || "";
    const withoutEmail = normalizeWhitespace(cleaned.replace(email, "").trim());
    const phoneMatch = withoutEmail.match(phoneRegex);
    const phone = phoneMatch?.[0] || "";
    const base = normalizeWhitespace(withoutEmail.replace(phone, "").trim());

    const slashParts = base.split("/");
    const name = normalizeWhitespace(slashParts[0] || "");
    const rest = normalizeWhitespace(slashParts.slice(1).join("/") || "");
    const atMatch = rest.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);

    return {
      name,
      jobTitle: atMatch ? normalizeWhitespace(atMatch[1]) : rest,
      organization: atMatch ? normalizeWhitespace(atMatch[2]) : "",
      email,
      phone
    };
  };

  if (phoneMatches.length === 0) {
    return [parseChunk(text)].filter((item) => item.name || item.jobTitle || item.organization);
  }

  const chunks: string[] = [];
  let start = 0;

  for (const match of phoneMatches) {
    if (match.index === undefined) {
      continue;
    }

    const end = match.index + match[0].length;
    chunks.push(text.slice(start, end));
    start = end;
  }

  const tail = normalizeWhitespace(text.slice(start));
  if (tail) {
    chunks.push(tail);
  }

  return chunks
    .map((chunk) => parseChunk(chunk))
    .filter((item) => item.name || item.jobTitle || item.organization || item.email || item.phone);
};

const parseCertificationText = (rawText: string): {
  name: string;
  url: string;
  verificationId: string;
} => {
  const text = normalizeWhitespace(rawText);
  if (!text) {
    return { name: "", url: "", verificationId: "" };
  }

  const url = getUrlCandidates(text)[0] || "";
  const verificationMatch = text.match(
    /\b(?:verification(?:\s*id)?|credential(?:\s*id)?|certificate(?:\s*id)?|cert(?:\s*no)?)[:#\s-]*([A-Za-z0-9._-]+)/i
  );
  const cleaned = normalizeWhitespace(
    text
      .replace(url, " ")
      .replace(verificationMatch?.[0] || "", " ")
  );

  return {
    name: cleaned || text,
    url,
    verificationId: verificationMatch?.[1] || ""
  };
};

const parseCourseText = (rawText: string): {
  title: string;
  institution: string;
  url: string;
  description: string;
} => {
  const text = normalizeWhitespace(rawText);
  if (!text) {
    return { title: "", institution: "", url: "", description: "" };
  }

  const url = getUrlCandidates(text)[0] || "";
  const withoutUrl = normalizeWhitespace(text.replace(url, " "));
  const parts = withoutUrl.split(/\s*[-–—|]\s*/).map((part) => normalizeWhitespace(part));

  return {
    title: parts[0] || withoutUrl,
    institution: parts[1] || "",
    url,
    description: parts.slice(2).join(" ").trim()
  };
};

const parseProjectText = (rawText: string): {
  title: string;
  subtitle: string;
  startDate: string;
  endDate: string;
  description: string;
} => {
  const text = normalizeWhitespace(rawText);
  if (!text) {
    return { title: "", subtitle: "", startDate: "", endDate: "", description: "" };
  }

  const dateParts = extractDateRange(text);
  const descriptor = dateParts.before || text;
  const parts = descriptor.split(/\s*[-–—|]\s*/).map((part) => normalizeWhitespace(part));

  return {
    title: parts[0] || descriptor,
    subtitle: parts[1] || "",
    startDate: dateParts.startDate,
    endDate: dateParts.endDate,
    description: dateParts.after || text
  };
};

const parseAwardText = (rawText: string): {
  name: string;
  issuer: string;
  date: string;
  description: string;
} => {
  const text = normalizeWhitespace(rawText);
  if (!text) {
    return { name: "", issuer: "", date: "", description: "" };
  }

  const issuerMatch = text.match(/(?:by|from|at)\s+([^,;]+)/i);
  const dateParts = extractDateRange(text);
  const dateMatch = text.match(/\b(?:19|20)\d{2}\b/);

  return {
    name: dateParts.before || text,
    issuer: normalizeWhitespace(issuerMatch?.[1] || ""),
    date: dateParts.endDate || dateParts.startDate || dateMatch?.[0] || "",
    description: dateParts.after || ""
  };
};

const parsePublicationText = (rawText: string): {
  title: string;
  publisher: string;
  date: string;
  description: string;
} => {
  const text = normalizeWhitespace(rawText);
  if (!text) {
    return { title: "", publisher: "", date: "", description: "" };
  }

  const dateParts = extractDateRange(text);
  const dateMatch = text.match(/\b(?:19|20)\d{2}\b/);
  const publisherMatch = text.match(/(?:published\s+by|publisher|journal|conference|in)\s+([^,;]+)/i);
  const descriptor = normalizeWhitespace(dateParts.before || text);
  const parts = descriptor.split(/\s*[-–—|]\s*/).map((part) => normalizeWhitespace(part));

  return {
    title: parts[0] || descriptor,
    publisher: normalizeWhitespace(publisherMatch?.[1] || parts[1] || ""),
    date: dateParts.endDate || dateParts.startDate || dateMatch?.[0] || "",
    description: dateParts.after || ""
  };
};

const toVisibility = (hidden: boolean): CvVisibility => (hidden ? "hidden" : "visible");

const toJsonValue = (value: unknown): CvJsonValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }

  if (typeof value === "object") {
    const next: Record<string, CvJsonValue> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      next[key] = toJsonValue(entry);
    }
    return next;
  }

  return String(value);
};

const toJsonRecord = (value: unknown): Record<string, CvJsonValue> => {
  const record = asRecord(value);
  const result: Record<string, CvJsonValue> = {};

  for (const [key, entry] of Object.entries(record)) {
    result[key] = toJsonValue(entry);
  }

  return result;
};

const mergeJsonRecords = (...records: Array<unknown>): Record<string, CvJsonValue> => {
  const merged: Record<string, CvJsonValue> = {};

  for (const record of records) {
    const normalized = toJsonRecord(record);
    for (const [key, value] of Object.entries(normalized)) {
      merged[key] = value;
    }
  }

  return merged;
};

const normalizeItems = (value: unknown, sectionType: string): EditorItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const record = asRecord(entry);
    const normalizedId = asString(record.id) || `${sectionType}-item-${index + 1}`;

    return {
      id: normalizedId,
      ...record
    };
  });
};

const normalizeIdPart = (value: string): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
};

const normalizeSectionType = (value: string): string => {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");

  switch (normalized) {
    case "contact":
    case "contacts":
    case "contact_info":
      return "header";
    case "profile":
    case "professional_summary":
    case "personal_profile":
    case "about":
    case "about_me":
    case "summary_text":
    case "objective":
      return "summary";
    case "work_experience":
    case "employment":
    case "professional_experience":
      return "experience";
    case "language":
      return "languages";
    case "certification":
    case "certificate":
      return "certifications";
    case "course":
      return "courses";
    case "project":
      return "projects";
    case "volunteer_work":
    case "volunteering":
      return "volunteer";
    case "award":
      return "awards";
    case "publication":
      return "publications";
    case "reference":
      return "references";
    default:
      return normalized;
  }
};

const deterministicSectionId = (sectionType: string, sectionOrder: number): string => {
  const typePart = normalizeIdPart(sectionType) || "section";
  return `${typePart}-${sectionOrder + 1}`;
};

const deterministicBlockId = (
  section: EditorSection,
  sectionType: string,
  item: EditorItem,
  index: number
): string => {
  const sectionPart = normalizeIdPart(section.backendSectionId || sectionType) || "section";
  const itemPart = normalizeIdPart(asString(item.id)) || String(index + 1);
  return `${sectionType}-${sectionPart}-${itemPart}`.slice(0, 120);
};

const resolveUniqueId = (preferredId: string, used: Set<string>): string => {
  const base = preferredId.trim() || "block";

  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  let suffix = 2;
  let next = `${base}-${suffix}`;
  while (used.has(next)) {
    suffix += 1;
    next = `${base}-${suffix}`;
  }

  used.add(next);
  return next;
};

const withBlockState = (block: CvBlock, index: number): Pick<EditorItem, "id" | "blockId" | "blockType" | "hidden" | "rawFields" | "rawMeta"> => ({
  id: block.id || `block-${index + 1}`,
  blockId: block.id,
  blockType: block.type,
  hidden: block.visibility === "hidden",
  rawFields: toJsonRecord(block.fields),
  rawMeta: toJsonRecord(block.meta)
});

const blockTextCandidates = (block: CvBlock): string[] => {
  const fromItems = asStringArray(block.fields.items);
  const fromText = getField(block, "text")
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter((line) => line.length > 0);

  return dedupe([...fromItems, ...fromText]);
};

const isLegacyItemsBlock = (sectionType: string, block: CvBlock): boolean => {
  const blockType = block.type.trim().toLowerCase();
  if (blockType === `${sectionType}_items`) {
    return true;
  }

  if (blockType.endsWith("_items") && Array.isArray(block.fields.items)) {
    return true;
  }

  return false;
};

const mergeDescriptionText = (currentValue: string, addition: string): string => {
  const left = normalizeWhitespace(currentValue);
  const right = normalizeWhitespace(addition);
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return `${left}\n${right}`;
};

const defaultSectionTitle = (sectionType: string): string => {
  if (!sectionType) {
    return "Section";
  }

  return `${sectionType.charAt(0).toUpperCase()}${sectionType.slice(1)}`;
};

const detectSocialTypeFromUrl = (url: string): string => {
  const normalized = url.trim().toLowerCase();
  if (!normalized) {
    return "website";
  }

  if (normalized.includes("linkedin.com")) {
    return "linkedin";
  }
  if (normalized.includes("github.com")) {
    return "github";
  }
  if (normalized.includes("gitlab.com")) {
    return "gitlab";
  }
  if (normalized.includes("behance.net")) {
    return "behance";
  }
  if (normalized.includes("dribbble.com")) {
    return "dribbble";
  }

  return "portfolio";
};

const normalizeSocialUrl = (rawUrl: string): string => {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }

  const slashless = trimmed.replace(/^\/+/, "");
  const handleMatch = slashless.match(/^(?:linkedin|in)\/([A-Za-z0-9._-]{2,})$/i);
  if (handleMatch) {
    return `https://www.linkedin.com/in/${handleMatch[1]}`;
  }

  const githubHandleMatch = slashless.match(/^github\/([A-Za-z0-9._-]{2,})$/i);
  if (githubHandleMatch) {
    return `https://github.com/${githubHandleMatch[1]}`;
  }

  const candidate = /^(https?:\/\/)/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }

    const host = parsed.hostname.toLowerCase();
    if (!host || host === "localhost" || !host.includes(".")) {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
};

const extractSocialLinks = (metadata: Record<string, CvJsonValue>): EditorHeaderData["socialLinks"] => {
  const linksFromSocial = Array.isArray(metadata.social_links)
    ? metadata.social_links
        .map((entry) => asRecord(entry))
        .map((entry) => ({
          id: asString(entry.id) || randomId("social"),
          type: asString(entry.type) || detectSocialTypeFromUrl(asString(entry.url)),
          url: normalizeSocialUrl(asString(entry.url))
        }))
        .filter((entry) => entry.url.length > 0)
    : [];

  const linksFromUrls = Array.isArray(metadata.urls)
    ? metadata.urls
        .map((entry) => normalizeSocialUrl(asString(entry)))
        .filter((entry) => entry.length > 0)
        .map((url) => ({
          id: randomId("social"),
          type: detectSocialTypeFromUrl(url),
          url
        }))
    : [];

  const deduped = new Map<string, { id: string; type: string; url: string }>();
  for (const link of [...linksFromSocial, ...linksFromUrls]) {
    const key = link.url.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, link);
    }
  }

  return [...deduped.values()];
};

const STRICT_MAPPED_FIELDS_SECTION_TYPES = new Set([
  "experience",
  "education",
  "languages",
  "certifications",
  "courses",
  "projects",
  "volunteer",
  "awards",
  "publications",
  "references"
]);

const resolveSectionFields = (
  sectionType: string,
  rawFields: unknown,
  mappedFields: Record<string, CvJsonValue>
): Record<string, CvJsonValue> => {
  if (STRICT_MAPPED_FIELDS_SECTION_TYPES.has(sectionType)) {
    return mergeJsonRecords(mappedFields);
  }

  return mergeJsonRecords(rawFields, mappedFields);
};

const sectionFromItems = (
  section: EditorSection,
  sectionIndex: number,
  mapItem: (item: EditorItem, index: number) => {
    type: string;
    fields: Record<string, CvJsonValue>;
    meta?: Record<string, CvJsonValue>;
  }
): CvSection => {
  const sectionType = section.type || "custom";
  const items = normalizeItems(section.data.items, sectionType);
  const usedBlockIds = new Set<string>();

  const blocks: CvBlock[] = items.map((item, index) => {
    const mapped = mapItem(item, index);
    const preferredBlockId =
      asString(item.blockId) || deterministicBlockId(section, sectionType, item, index);
    const blockId = resolveUniqueId(preferredBlockId, usedBlockIds);

    return {
      id: blockId,
      type: asString(item.blockType) || mapped.type,
      order: index,
      visibility: section.hidden ? "hidden" : toVisibility(Boolean(item.hidden)),
      fields: resolveSectionFields(sectionType, item.rawFields, mapped.fields),
      meta: mergeJsonRecords(item.rawMeta, mapped.meta)
    };
  });

  return {
    id: section.backendSectionId || deterministicSectionId(sectionType, sectionIndex),
    type: sectionType,
    title: defaultSectionTitle(sectionType),
    order: sectionIndex,
    meta: section.hidden ? { visibility: "hidden" } : {},
    blocks
  };
};

export const cvContentToEditorSections = (content: CvContent): EditorSection[] => {
  const metadata = asRecord(content.metadata);
  const sortedSections = [...content.sections].sort((a, b) => a.order - b.order);
  const headerSection = sortedSections.find((section) => normalizeSectionType(section.type) === "header");
  const headerBlock = headerSection
    ? [...headerSection.blocks].sort((a, b) => a.order - b.order)[0]
    : undefined;
  const headerText = headerBlock ? getField(headerBlock, "text") : "";
  const getHeaderField = (...keys: string[]): string => (headerBlock ? getField(headerBlock, ...keys) : "");

  const inferHeaderNameFromText = (text: string): string => {
    const lines = text
      .split(/\n+/)
      .map((line) => normalizeWhitespace(line))
      .filter((line) => line.length > 0);

    return (
      lines.find((line) => {
        if (line.length < 3 || line.length > 72) {
          return false;
        }

        if (/\d/.test(line) || line.includes("@") || /https?:\/\//i.test(line)) {
          return false;
        }

        const words = line.split(/\s+/).filter(Boolean);
        return words.length >= 2 && words.length <= 6;
      }) ?? ""
    );
  };

  const inferEmailFromText = (text: string): string => {
    const normalized = text.replace(/([A-Z0-9._%+-])\s*@\s*([A-Z0-9.-]+\.[A-Z]{2,})/gi, "$1@$2");
    return normalized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  };

  const inferPhoneFromText = (text: string): string => text.match(/\+?\d[\d\s().-]{7,}\d/)?.[0] ?? "";
  const extractUrlsFromText = (text: string): string[] => {
    const direct = text.match(/(?:https?:\/\/|www\.)[^\s<>()]+/gi) ?? [];
    const handles = text.match(/\b(?:linkedin|github|gitlab|in)\/[A-Za-z0-9._-]{2,}\b/gi) ?? [];
    return [...direct, ...handles];
  };

  const metadataWithHeaderFallback: Record<string, CvJsonValue> = {
    ...content.metadata,
    full_name: toJsonValue(
      firstNonEmpty(
        asString(metadata.full_name),
        getHeaderField("full_name", "name"),
        inferHeaderNameFromText(headerText)
      )
    ),
    headline: toJsonValue(firstNonEmpty(asString(metadata.headline), getHeaderField("headline", "title"))),
    email: toJsonValue(firstNonEmpty(asString(metadata.email), getHeaderField("email"), inferEmailFromText(headerText))),
    phone: toJsonValue(firstNonEmpty(asString(metadata.phone), getHeaderField("phone"), inferPhoneFromText(headerText))),
    location: toJsonValue(firstNonEmpty(asString(metadata.location), getHeaderField("location"))),
    photo: toJsonValue(asString(metadata.photo)),
    urls: toJsonValue(
      dedupe([
        ...asStringArray(content.metadata.urls),
        ...(headerBlock ? asStringArray(headerBlock.fields.urls) : []),
        ...extractUrlsFromText(headerText)
      ].map((url) => normalizeSocialUrl(url)).filter((url) => url.length > 0))
    )
  };
  const normalizedMetadata = asRecord(metadataWithHeaderFallback);

  const sections: EditorSection[] = [
    {
      id: "header",
      type: "header",
      hidden: false,
      order: -1,
      data: {
        name: asString(normalizedMetadata.full_name),
        title: asString(normalizedMetadata.headline),
        email: asString(normalizedMetadata.email),
        phone: asString(normalizedMetadata.phone),
        location: asString(normalizedMetadata.location),
        photo: asString(normalizedMetadata.photo),
        socialLinks: extractSocialLinks(metadataWithHeaderFallback)
      }
    }
  ];

  for (const section of sortedSections) {
    const sectionType = normalizeSectionType(section.type);
    const sortedBlocks = [...section.blocks].sort((a, b) => a.order - b.order);
    const sectionHidden =
      asString(section.meta.visibility).toLowerCase() === "hidden" ||
      (sortedBlocks.length > 0 && sortedBlocks.every((block) => block.visibility === "hidden"));

    if (sectionType === "header") {
      continue;
    }

    if (sectionType === "summary") {
      const block = sortedBlocks[0];
      const rawSummaryText = block
        ? getField(block, "text", "summary", "description", "summary_text", "profile", "objective")
        : "";
      const fullName = asString(normalizedMetadata.full_name);
      const summaryText = (() => {
        const lines = rawSummaryText
          .split(/\n+/)
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        const dedupedLines: string[] = [];
        for (const line of lines) {
          if (dedupedLines[dedupedLines.length - 1] !== line) {
            dedupedLines.push(line);
          }
        }

        if (
          dedupedLines.length > 1 &&
          fullName &&
          dedupedLines[0].toLowerCase() === fullName.trim().toLowerCase()
        ) {
          dedupedLines.shift();
        }

        return dedupedLines.join("\n").trim();
      })();

      sections.push({
        id: `summary-${section.id}`,
        backendSectionId: section.id,
        type: "summary",
        hidden: sectionHidden,
        order: section.order,
        data: {
          text: summaryText,
          blockId: block?.id,
          blockType: block?.type,
          rawFields: block ? toJsonRecord(block.fields) : {},
          rawMeta: block ? toJsonRecord(block.meta) : {}
        }
      });
      continue;
    }

    if (sectionType === "experience") {
      const items: EditorItem[] = [];
      let pendingLegacyDescriptions: string[] = [];

      for (const [index, block] of sortedBlocks.entries()) {
        if (isLegacyItemsBlock("experience", block)) {
          const legacyText = blockTextCandidates(block).join("\n");
          if (!legacyText) {
            continue;
          }

          if (items.length > 0) {
            const lastItem = items[items.length - 1];
            lastItem.description = mergeDescriptionText(asString(lastItem.description), legacyText);
          } else {
            pendingLegacyDescriptions.push(legacyText);
          }
          continue;
        }

        const structuredCompany = getField(block, "company", "organization");
        const structuredRole = getField(block, "role", "position", "title", "headline");
        const startDate = getField(block, "start_date", "start");
        const endDate = getField(block, "end_date", "end");
        const structuredDescription = getField(block, "description", "summary", "highlights", "responsibilities");

        const shouldUseTextFallback =
          !structuredRole ||
          !structuredCompany ||
          (!startDate && !endDate && !asBoolean(block.fields.current_role)) ||
          !structuredDescription;
        const parsedFromText = shouldUseTextFallback ? parseExperienceText(getField(block, "text")) : null;
        const normalizedStartDate = firstNonEmpty(startDate, parsedFromText?.startDate ?? "");
        const normalizedEndDate = firstNonEmpty(endDate, parsedFromText?.endDate ?? "");
        const currentRole =
          asBoolean(block.fields.current_role) ||
          normalizedEndDate.toLowerCase() === "present" ||
          Boolean(parsedFromText?.currentRole);

        let role = firstNonEmpty(structuredRole, parsedFromText?.role ?? "");
        let company = firstNonEmpty(structuredCompany, parsedFromText?.company ?? "");

        if (!company && role) {
          const recovered = parseRoleCompany(role);
          if (recovered.company) {
            role = recovered.role;
            company = recovered.company;
          }
        }

        let description = firstNonEmpty(structuredDescription, parsedFromText?.description ?? "");
        if (pendingLegacyDescriptions.length > 0) {
          description = mergeDescriptionText(pendingLegacyDescriptions.join("\n"), description);
          pendingLegacyDescriptions = [];
        }

        items.push({
          ...withBlockState(block, index),
          company,
          role,
          country: getField(block, "location", "country", "city"),
          startDate: normalizedStartDate,
          endDate: normalizedEndDate,
          currentRole,
          dates: buildDates(normalizedStartDate, normalizedEndDate),
          description
        });
      }

      if (pendingLegacyDescriptions.length > 0 && items.length > 0) {
        const lastItem = items[items.length - 1];
        lastItem.description = mergeDescriptionText(asString(lastItem.description), pendingLegacyDescriptions.join("\n"));
      }

      sections.push({
        id: `experience-${section.id}`,
        backendSectionId: section.id,
        type: "experience",
        hidden: sectionHidden,
        order: section.order,
        data: { items }
      });
      continue;
    }

    if (sectionType === "education") {
      const items: EditorItem[] = sortedBlocks.map((block, index) => {
        const parsedFromText = parseEducationText(getField(block, "text"));
        const startDate = getField(block, "start_date", "start");
        const endDate = getField(block, "end_date", "end");

        return {
          ...withBlockState(block, index),
          institution: firstNonEmpty(
            getField(block, "institution", "school", "university"),
            parsedFromText.institution
          ),
          degree: firstNonEmpty(getField(block, "degree", "title"), parsedFromText.degree),
          fieldOfStudy: firstNonEmpty(
            getField(block, "field_of_study", "major"),
            parsedFromText.fieldOfStudy
          ),
          gpa: firstNonEmpty(getField(block, "gpa"), parsedFromText.gpa),
          startDate: firstNonEmpty(startDate, parsedFromText.startDate),
          endDate: firstNonEmpty(endDate, parsedFromText.endDate),
          expectedGraduation:
            asBoolean(block.fields.expected_graduation) || asBoolean(block.fields.expectedGraduation),
          exchangeProgram:
            asBoolean(block.fields.exchange_program) || asBoolean(block.fields.exchangeProgram),
          description: firstNonEmpty(getField(block, "description", "notes"), parsedFromText.description)
        };
      });

      sections.push({
        id: `education-${section.id}`,
        backendSectionId: section.id,
        type: "education",
        hidden: sectionHidden,
        order: section.order,
        data: { items }
      });
      continue;
    }

    if (sectionType === "skills") {
      const skills = sortedBlocks
        .flatMap((block) => {
          const direct = [getField(block, "skill", "name", "text")].filter(Boolean);
          const arrays = [...asStringArray(block.fields.skills), ...asStringArray(block.fields.items)];
          return [...direct, ...arrays];
        })
        .map((skill) => skill.trim())
        .filter((skill) => skill.length > 0);

      sections.push({
        id: `skills-${section.id}`,
        backendSectionId: section.id,
        type: "skills",
        hidden: sectionHidden,
        order: section.order,
        data: {
          skills,
          blockId: sortedBlocks[0]?.id ?? ""
        }
      });
      continue;
    }

    if (sectionType === "languages") {
      const items: EditorItem[] = sortedBlocks.flatMap((block, index) => {
        const structuredLanguage = getField(block, "language", "name", "title");
        const fallbackText = getField(block, "text");

        if (structuredLanguage) {
          return [
            {
              ...withBlockState(block, index),
              language: structuredLanguage,
              proficiency: getField(block, "proficiency", "level", "fluency"),
              certificate: getField(block, "certificate", "score", "certification"),
              notes: getField(block, "notes", "description", "details")
            }
          ];
        }

        const parsedItems = parseLanguageItems(fallbackText);
        if (parsedItems.length === 0) {
          return [
            {
              ...withBlockState(block, index),
              language: "",
              proficiency: "",
              certificate: "",
              notes: fallbackText
            }
          ];
        }

        return parsedItems.map((item, parsedIndex) => ({
          ...withBlockState(block, index),
          id: `${block.id || `block-${index + 1}`}-lang-${parsedIndex + 1}`,
          language: item.language,
          proficiency: item.proficiency,
          certificate: item.certificate,
          notes: item.notes
        }));
      });

      sections.push({
        id: `languages-${section.id}`,
        backendSectionId: section.id,
        type: "languages",
        hidden: sectionHidden,
        order: section.order,
        data: { items }
      });
      continue;
    }

    if (sectionType === "certifications") {
      const items: EditorItem[] = sortedBlocks.flatMap((block, index) => {
        const structuredName = getField(block, "name", "title", "certificate");
        if (structuredName) {
          return [
            {
              ...withBlockState(block, index),
              name: structuredName,
              url: getField(block, "url", "link"),
              verificationId: getField(block, "verification_id", "verificationId", "credential_id")
            }
          ];
        }

        const candidates = blockTextCandidates(block);
        if (candidates.length === 0) {
          return [];
        }

        return candidates.map((candidate, candidateIndex) => {
          const parsed = parseCertificationText(candidate);
          return {
            ...withBlockState(block, index),
            id: `${block.id || `block-${index + 1}`}-cert-${candidateIndex + 1}`,
            name: parsed.name,
            url: parsed.url,
            verificationId: parsed.verificationId
          };
        });
      });

      sections.push({
        id: `certifications-${section.id}`,
        backendSectionId: section.id,
        type: "certifications",
        hidden: sectionHidden,
        order: section.order,
        data: {
          items: items.filter((item) =>
            [item.name, item.url, item.verificationId].some((value) => asString(value).trim().length > 0)
          )
        }
      });
      continue;
    }

    if (sectionType === "courses") {
      const items: EditorItem[] = sortedBlocks.flatMap((block, index) => {
        const structuredTitle = getField(block, "title", "name", "course");
        if (structuredTitle) {
          return [
            {
              ...withBlockState(block, index),
              title: structuredTitle,
              institution: getField(block, "institution", "provider", "organization"),
              url: getField(block, "url", "link"),
              description: getField(block, "description", "summary", "details")
            }
          ];
        }

        const candidates = blockTextCandidates(block);
        if (candidates.length === 0) {
          return [];
        }

        return candidates.map((candidate, candidateIndex) => {
          const parsed = parseCourseText(candidate);
          return {
            ...withBlockState(block, index),
            id: `${block.id || `block-${index + 1}`}-course-${candidateIndex + 1}`,
            title: parsed.title,
            institution: parsed.institution,
            url: parsed.url,
            description: parsed.description
          };
        });
      });

      sections.push({
        id: `courses-${section.id}`,
        backendSectionId: section.id,
        type: "courses",
        hidden: sectionHidden,
        order: section.order,
        data: {
          items: items.filter((item) =>
            [item.title, item.institution, item.url, item.description].some(
              (value) => asString(value).trim().length > 0
            )
          )
        }
      });
      continue;
    }

    if (sectionType === "projects") {
      const items: EditorItem[] = sortedBlocks.flatMap((block, index) => {
        const structuredTitle = getField(block, "title", "name", "project");
        if (structuredTitle) {
          return [
            {
              ...withBlockState(block, index),
              title: structuredTitle,
              subtitle: getField(block, "subtitle", "role", "stack"),
              startDate: getField(block, "start_date", "start"),
              endDate: getField(block, "end_date", "end"),
              description: getField(block, "description", "summary", "details")
            }
          ];
        }

        const candidates = blockTextCandidates(block);
        if (candidates.length === 0) {
          return [];
        }

        return candidates.map((candidate, candidateIndex) => {
          const parsed = parseProjectText(candidate);
          return {
            ...withBlockState(block, index),
            id: `${block.id || `block-${index + 1}`}-project-${candidateIndex + 1}`,
            title: parsed.title,
            subtitle: parsed.subtitle,
            startDate: parsed.startDate,
            endDate: parsed.endDate,
            description: parsed.description
          };
        });
      });

      sections.push({
        id: `projects-${section.id}`,
        backendSectionId: section.id,
        type: "projects",
        hidden: sectionHidden,
        order: section.order,
        data: {
          items: items.filter((item) =>
            [item.title, item.subtitle, item.startDate, item.endDate, item.description].some(
              (value) => asString(value).trim().length > 0
            )
          )
        }
      });
      continue;
    }

    if (sectionType === "volunteer") {
      const items: EditorItem[] = sortedBlocks.map((block, index) => {
        const parsedFromText = parseVolunteerText(getField(block, "text"));
        const structuredRole = getField(block, "role", "position", "title");
        const normalizedStructuredRole = isYearOnly(structuredRole) ? "" : structuredRole;
        const startDate = getField(block, "start_date", "start");
        const endDate = getField(block, "end_date", "end");
        const normalizedStartDate = firstNonEmpty(startDate, parsedFromText.startDate);
        const normalizedEndDate = firstNonEmpty(endDate, parsedFromText.endDate);
        const currentRole =
          asBoolean(block.fields.current_role) ||
          normalizedEndDate.toLowerCase() === "present" ||
          parsedFromText.currentRole;

        return {
          ...withBlockState(block, index),
          organization: firstNonEmpty(
            parsedFromText.organization,
            getField(block, "organization", "company")
          ),
          role: firstNonEmpty(normalizedStructuredRole, parsedFromText.role),
          country: getField(block, "location", "country", "city"),
          startDate: normalizedStartDate,
          endDate: normalizedEndDate,
          currentRole,
          description: firstNonEmpty(
            getField(block, "description", "summary", "details"),
            parsedFromText.description
          )
        };
      });

      sections.push({
        id: `volunteer-${section.id}`,
        backendSectionId: section.id,
        type: "volunteer",
        hidden: sectionHidden,
        order: section.order,
        data: { items }
      });
      continue;
    }

    if (sectionType === "awards") {
      const items: EditorItem[] = sortedBlocks.flatMap((block, index) => {
        const structuredName = getField(block, "name", "title", "award");
        if (structuredName) {
          return [
            {
              ...withBlockState(block, index),
              name: structuredName,
              issuer: getField(block, "issuer", "organization"),
              date: getField(block, "date"),
              description: getField(block, "description", "summary", "details")
            }
          ];
        }

        const candidates = blockTextCandidates(block);
        if (candidates.length === 0) {
          return [];
        }

        return candidates.map((candidate, candidateIndex) => {
          const parsed = parseAwardText(candidate);
          return {
            ...withBlockState(block, index),
            id: `${block.id || `block-${index + 1}`}-award-${candidateIndex + 1}`,
            name: parsed.name,
            issuer: parsed.issuer,
            date: parsed.date,
            description: parsed.description
          };
        });
      });

      sections.push({
        id: `awards-${section.id}`,
        backendSectionId: section.id,
        type: "awards",
        hidden: sectionHidden,
        order: section.order,
        data: {
          items: items.filter((item) =>
            [item.name, item.issuer, item.date, item.description].some(
              (value) => asString(value).trim().length > 0
            )
          )
        }
      });
      continue;
    }

    if (sectionType === "publications") {
      const items: EditorItem[] = sortedBlocks.flatMap((block, index) => {
        const structuredTitle = getField(block, "title", "name", "publication");
        if (structuredTitle) {
          return [
            {
              ...withBlockState(block, index),
              title: structuredTitle,
              publisher: getField(block, "publisher", "journal", "organization"),
              date: getField(block, "date"),
              description: getField(block, "description", "summary", "details")
            }
          ];
        }

        const candidates = blockTextCandidates(block);
        if (candidates.length === 0) {
          return [];
        }

        return candidates.map((candidate, candidateIndex) => {
          const parsed = parsePublicationText(candidate);
          return {
            ...withBlockState(block, index),
            id: `${block.id || `block-${index + 1}`}-pub-${candidateIndex + 1}`,
            title: parsed.title,
            publisher: parsed.publisher,
            date: parsed.date,
            description: parsed.description
          };
        });
      });

      sections.push({
        id: `publications-${section.id}`,
        backendSectionId: section.id,
        type: "publications",
        hidden: sectionHidden,
        order: section.order,
        data: {
          items: items.filter((item) =>
            [item.title, item.publisher, item.date, item.description].some(
              (value) => asString(value).trim().length > 0
            )
          )
        }
      });
      continue;
    }

    if (sectionType === "references") {
      const items: EditorItem[] = sortedBlocks.flatMap((block, index) => {
        const structuredName = getField(block, "name", "full_name");
        if (structuredName) {
          return [
            {
              ...withBlockState(block, index),
              name: structuredName,
              jobTitle: getField(block, "job_title", "title", "role"),
              organization: getField(block, "organization", "company"),
              email: getField(block, "email"),
              phone: getField(block, "phone", "phone_number")
            }
          ];
        }

        const parsedItems = parseReferenceItems(getField(block, "text"));
        if (parsedItems.length === 0) {
          return [];
        }

        return parsedItems.map((item, parsedIndex) => ({
          ...withBlockState(block, index),
          id: `${block.id || `block-${index + 1}`}-ref-${parsedIndex + 1}`,
          name: item.name,
          jobTitle: item.jobTitle,
          organization: item.organization,
          email: item.email,
          phone: item.phone
        }));
      });

      sections.push({
        id: `references-${section.id}`,
        backendSectionId: section.id,
        type: "references",
        hidden: sectionHidden,
        order: section.order,
        data: {
          items: items.filter((item) =>
            [item.name, item.jobTitle, item.organization, item.email, item.phone].some(
              (value) => asString(value).trim().length > 0
            )
          )
        }
      });
      continue;
    }

    const items: EditorItem[] = sortedBlocks.map((block, index) => {
      const startDate = getField(block, "start_date", "start");
      const endDate = getField(block, "end_date", "end");

      return {
        ...withBlockState(block, index),
        title: getField(block, "title", "name", "headline", "role", "degree"),
        subtitle: getField(
          block,
          "subtitle",
          "company",
          "institution",
          "organization",
          "field_of_study"
        ),
        description: getField(block, "description", "summary", "highlights", "details"),
        dates: buildDates(startDate, endDate) || getField(block, "date", "period")
      };
    });

    sections.push({
      id: `${section.type}-${section.id}`,
      backendSectionId: section.id,
      type: sectionType,
      hidden: sectionHidden,
      order: section.order,
      data: { items }
    });
  }

  const summaryAlreadyExists = sections.some((section) => section.type === "summary");
  if (!summaryAlreadyExists) {
    const metadataSummaryText = firstNonEmpty(
      asString(normalizedMetadata.summary_text),
      asString(normalizedMetadata.summary),
      asString(normalizedMetadata.profile),
      asString(normalizedMetadata.objective)
    );

    if (metadataSummaryText) {
      const summaryOrder = Math.max(
        0,
        ...sections.filter((section) => section.type !== "header").map((section) => section.order + 1)
      );

      sections.push({
        id: "summary-metadata-fallback",
        type: "summary",
        hidden: false,
        order: summaryOrder,
        data: {
          text: metadataSummaryText,
          blockId: "",
          blockType: "summary",
          rawFields: {},
          rawMeta: {}
        }
      });
    }
  }

  return sections;
};

export const editorSectionsToCvContent = (
  sections: EditorSection[],
  language: string,
  existing?: CvContent
): CvContent => {
  const header = sections.find((section) => section.type === "header");
  const headerData = asRecord(header?.data);

  const socialLinks = (Array.isArray(headerData.socialLinks)
    ? headerData.socialLinks.map((entry) => {
        const record = asRecord(entry);
        return {
          id: asString(record.id) || randomId("social"),
          type: asString(record.type) || "website",
          url: asString(record.url)
        };
      })
    : []) as CvJsonValue;

  const urlList = (Array.isArray(headerData.socialLinks)
    ? dedupe(
        headerData.socialLinks
          .map((entry) => {
            const record = asRecord(entry);
            return asString(record.url).trim();
          })
          .filter((url) => url.length > 0)
      )
    : []) as CvJsonValue;

  const metadata: Record<string, CvJsonValue> = {
    ...(existing?.metadata ?? {}),
    full_name: toJsonValue(asString(headerData.name)),
    headline: toJsonValue(asString(headerData.title)),
    email: toJsonValue(asString(headerData.email)),
    phone: toJsonValue(asString(headerData.phone)),
    location: toJsonValue(asString(headerData.location)),
    photo: toJsonValue(asString(headerData.photo)),
    social_links: socialLinks,
    urls: urlList
  };

  const bodySections = sections
    .filter((section) => section.type !== "header")
    .sort((a, b) => a.order - b.order)
    .map((section, sectionIndex) => {
      const sectionType = normalizeSectionType(section.type || "");
      const normalizedSection =
        sectionType === section.type ? section : { ...section, type: sectionType };

      if (sectionType === "summary") {
        const summaryData = asRecord(section.data);
        const text = asString(summaryData.text);
        const rawFields = toJsonRecord(summaryData.rawFields);
        const rawMeta = toJsonRecord(summaryData.rawMeta);

        const blockId =
          asString(summaryData.blockId) ||
          deterministicBlockId(
            normalizedSection,
            "summary",
            { id: asString(summaryData.blockId) || "summary", blockId: asString(summaryData.blockId) },
            0
          );

        return {
          id: section.backendSectionId || deterministicSectionId("summary", sectionIndex),
          type: "summary",
          title: "Summary",
          order: sectionIndex,
          meta: section.hidden ? { visibility: "hidden" } : {},
          blocks: [
            {
              id: blockId,
              type: asString(summaryData.blockType) || "summary",
              order: 0,
              visibility: toVisibility(section.hidden),
              fields: mergeJsonRecords(rawFields, {
                text: toJsonValue(text)
              }),
              meta: mergeJsonRecords(rawMeta)
            }
          ]
        } as CvSection;
      }

      if (sectionType === "experience") {
        return sectionFromItems(normalizedSection, sectionIndex, (item) => {
          const isCurrentRole = Boolean(item.currentRole);
          return {
            type: "experience_item",
            fields: {
              company: toJsonValue(asString(item.company)),
              role: toJsonValue(asString(item.role)),
              location: toJsonValue(asString(item.country)),
              start_date: toJsonValue(asString(item.startDate)),
              end_date: toJsonValue(isCurrentRole ? "Present" : asString(item.endDate)),
              current_role: toJsonValue(isCurrentRole),
              description: toJsonValue(asString(item.description))
            }
          };
        });
      }

      if (sectionType === "education") {
        return sectionFromItems(normalizedSection, sectionIndex, (item) => ({
          type: "education_item",
          fields: {
            institution: toJsonValue(asString(item.institution)),
            degree: toJsonValue(asString(item.degree)),
            field_of_study: toJsonValue(asString(item.fieldOfStudy)),
            gpa: toJsonValue(asString(item.gpa)),
            start_date: toJsonValue(asString(item.startDate)),
            end_date: toJsonValue(asString(item.endDate)),
            expected_graduation: toJsonValue(Boolean(item.expectedGraduation)),
            exchange_program: toJsonValue(Boolean(item.exchangeProgram)),
            description: toJsonValue(asString(item.description))
          }
        }));
      }

      if (sectionType === "skills") {
        const skillValues = asStringArray(asRecord(section.data).skills);
        const preferredBlockId = asString(asRecord(section.data).blockId);
        const sectionId = section.backendSectionId || deterministicSectionId("skills", sectionIndex);
        const blockId = preferredBlockId || `${normalizeIdPart(sectionId) || "skills"}-skills`;

        return {
          id: sectionId,
          type: "skills",
          title: "Skills",
          order: sectionIndex,
          meta: section.hidden ? { visibility: "hidden" } : {},
          blocks: [
            {
              id: blockId,
              type: "skills",
              order: 0,
              visibility: toVisibility(section.hidden),
              fields: {
                skills: toJsonValue(skillValues)
              },
              meta: {}
            }
          ]
        };
      }

      if (sectionType === "languages") {
        return sectionFromItems(normalizedSection, sectionIndex, (item) => ({
          type: "language_item",
          fields: {
            language: toJsonValue(asString(item.language)),
            proficiency: toJsonValue(asString(item.proficiency)),
            certificate: toJsonValue(asString(item.certificate)),
            notes: toJsonValue(asString(item.notes))
          }
        }));
      }

      if (sectionType === "certifications") {
        return sectionFromItems(normalizedSection, sectionIndex, (item) => ({
          type: "certification_item",
          fields: {
            name: toJsonValue(asString(item.name)),
            url: toJsonValue(asString(item.url)),
            verification_id: toJsonValue(asString(item.verificationId))
          }
        }));
      }

      if (sectionType === "courses") {
        return sectionFromItems(normalizedSection, sectionIndex, (item) => ({
          type: "course_item",
          fields: {
            title: toJsonValue(asString(item.title)),
            institution: toJsonValue(asString(item.institution)),
            url: toJsonValue(asString(item.url)),
            description: toJsonValue(asString(item.description))
          }
        }));
      }

      if (sectionType === "projects") {
        return sectionFromItems(normalizedSection, sectionIndex, (item) => ({
          type: "project_item",
          fields: {
            title: toJsonValue(asString(item.title)),
            subtitle: toJsonValue(asString(item.subtitle)),
            start_date: toJsonValue(asString(item.startDate)),
            end_date: toJsonValue(asString(item.endDate)),
            description: toJsonValue(asString(item.description))
          }
        }));
      }

      if (sectionType === "volunteer") {
        return sectionFromItems(normalizedSection, sectionIndex, (item) => {
          const isCurrentRole = Boolean(item.currentRole);
          return {
            type: "volunteer_item",
            fields: {
              organization: toJsonValue(asString(item.organization)),
              role: toJsonValue(asString(item.role)),
              location: toJsonValue(asString(item.country)),
              start_date: toJsonValue(asString(item.startDate)),
              end_date: toJsonValue(isCurrentRole ? "Present" : asString(item.endDate)),
              current_role: toJsonValue(isCurrentRole),
              description: toJsonValue(asString(item.description))
            }
          };
        });
      }

      if (sectionType === "awards") {
        return sectionFromItems(normalizedSection, sectionIndex, (item) => ({
          type: "award_item",
          fields: {
            name: toJsonValue(asString(item.name)),
            issuer: toJsonValue(asString(item.issuer)),
            date: toJsonValue(asString(item.date)),
            description: toJsonValue(asString(item.description))
          }
        }));
      }

      if (sectionType === "publications") {
        return sectionFromItems(normalizedSection, sectionIndex, (item) => ({
          type: "publication_item",
          fields: {
            title: toJsonValue(asString(item.title)),
            publisher: toJsonValue(asString(item.publisher)),
            date: toJsonValue(asString(item.date)),
            description: toJsonValue(asString(item.description))
          }
        }));
      }

      if (sectionType === "references") {
        return sectionFromItems(normalizedSection, sectionIndex, (item) => ({
          type: "reference_item",
          fields: {
            name: toJsonValue(asString(item.name)),
            job_title: toJsonValue(asString(item.jobTitle)),
            organization: toJsonValue(asString(item.organization)),
            email: toJsonValue(asString(item.email)),
            phone: toJsonValue(asString(item.phone))
          }
        }));
      }

      return sectionFromItems(normalizedSection, sectionIndex, (item) => ({
        type: `${sectionType || "custom"}_item`,
        fields: {
          title: toJsonValue(asString(item.title)),
          subtitle: toJsonValue(asString(item.subtitle)),
          description: toJsonValue(asString(item.description)),
          date: toJsonValue(asString(item.dates))
        }
      }));
    });

  return {
    version: "v1",
    language: language || existing?.language || "en",
    metadata,
    sections: bodySections
  };
};

export const getSectionFirstBlockId = (section: EditorSection): string | null => {
  if (section.type === "summary") {
    const blockId = asString(asRecord(section.data).blockId);
    return blockId || null;
  }

  if (section.type === "skills") {
    const blockId = asString(asRecord(section.data).blockId);
    return blockId || null;
  }

  const items = normalizeItems(section.data.items, section.type || "section");
  for (const item of items) {
    const blockId = asString(item.blockId);
    if (blockId) {
      return blockId;
    }
  }

  return null;
};

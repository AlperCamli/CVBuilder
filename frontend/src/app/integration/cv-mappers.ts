import type { CvBlock, CvContent, CvJsonValue, CvSection, CvVisibility } from "./api-types";

export interface EditorHeaderData {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
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

  const separatorMatch = text.match(/^(.+?)\s*[-–—|/]\s*(.+)$/);
  if (separatorMatch) {
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

const defaultSectionTitle = (sectionType: string): string => {
  if (!sectionType) {
    return "Section";
  }

  return `${sectionType.charAt(0).toUpperCase()}${sectionType.slice(1)}`;
};

const extractSocialLinks = (metadata: Record<string, CvJsonValue>): EditorHeaderData["socialLinks"] => {
  const raw = metadata.social_links;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => asRecord(entry))
    .map((entry) => ({
      id: asString(entry.id) || randomId("social"),
      type: asString(entry.type) || "website",
      url: asString(entry.url)
    }))
    .filter((entry) => entry.url.length > 0);
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
      fields: mergeJsonRecords(item.rawFields, mapped.fields),
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

  const sections: EditorSection[] = [
    {
      id: "header",
      type: "header",
      hidden: false,
      order: -1,
      data: {
        name: asString(metadata.full_name),
        title: asString(metadata.headline),
        email: asString(metadata.email),
        phone: asString(metadata.phone),
        location: asString(metadata.location),
        socialLinks: extractSocialLinks(content.metadata)
      }
    }
  ];

  const sortedSections = [...content.sections].sort((a, b) => a.order - b.order);

  for (const section of sortedSections) {
    const sortedBlocks = [...section.blocks].sort((a, b) => a.order - b.order);
    const sectionHidden =
      asString(section.meta.visibility).toLowerCase() === "hidden" ||
      (sortedBlocks.length > 0 && sortedBlocks.every((block) => block.visibility === "hidden"));

    if (section.type === "summary") {
      const block = sortedBlocks[0];
      const rawSummaryText = block ? getField(block, "text", "summary", "description") : "";
      const fullName = asString(metadata.full_name);
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

    if (section.type === "experience") {
      const items: EditorItem[] = sortedBlocks.map((block, index) => {
        const parsedFromText = parseExperienceText(getField(block, "text"));
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
          company: firstNonEmpty(
            getField(block, "company", "organization"),
            parsedFromText.company
          ),
          role: firstNonEmpty(
            getField(block, "role", "position", "title", "headline"),
            parsedFromText.role
          ),
          country: getField(block, "location", "country", "city"),
          startDate: normalizedStartDate,
          endDate: normalizedEndDate,
          currentRole,
          dates: buildDates(normalizedStartDate, normalizedEndDate),
          description: firstNonEmpty(
            getField(block, "description", "summary", "highlights", "responsibilities"),
            parsedFromText.description
          )
        };
      });

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

    if (section.type === "education") {
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

    if (section.type === "skills") {
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
        data: { skills }
      });
      continue;
    }

    if (section.type === "languages") {
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

    if (section.type === "certifications") {
      const items: EditorItem[] = sortedBlocks.map((block, index) => ({
        ...withBlockState(block, index),
        name: getField(block, "name", "title", "certificate"),
        url: getField(block, "url", "link"),
        verificationId: getField(block, "verification_id", "verificationId", "credential_id")
      }));

      sections.push({
        id: `certifications-${section.id}`,
        backendSectionId: section.id,
        type: "certifications",
        hidden: sectionHidden,
        order: section.order,
        data: { items }
      });
      continue;
    }

    if (section.type === "courses") {
      const items: EditorItem[] = sortedBlocks.map((block, index) => ({
        ...withBlockState(block, index),
        title: getField(block, "title", "name", "course"),
        institution: getField(block, "institution", "provider", "organization"),
        url: getField(block, "url", "link"),
        description: getField(block, "description", "summary", "details")
      }));

      sections.push({
        id: `courses-${section.id}`,
        backendSectionId: section.id,
        type: "courses",
        hidden: sectionHidden,
        order: section.order,
        data: { items }
      });
      continue;
    }

    if (section.type === "projects") {
      const items: EditorItem[] = sortedBlocks.map((block, index) => ({
        ...withBlockState(block, index),
        title: getField(block, "title", "name", "project"),
        subtitle: getField(block, "subtitle", "role", "stack"),
        startDate: getField(block, "start_date", "start"),
        endDate: getField(block, "end_date", "end"),
        description: getField(block, "description", "summary", "details")
      }));

      sections.push({
        id: `projects-${section.id}`,
        backendSectionId: section.id,
        type: "projects",
        hidden: sectionHidden,
        order: section.order,
        data: { items }
      });
      continue;
    }

    if (section.type === "volunteer") {
      const items: EditorItem[] = sortedBlocks.map((block, index) => {
        const parsedFromText = parseVolunteerText(getField(block, "text"));
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
            getField(block, "organization", "company"),
            parsedFromText.organization
          ),
          role: firstNonEmpty(getField(block, "role", "position", "title"), parsedFromText.role),
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

    if (section.type === "awards") {
      const items: EditorItem[] = sortedBlocks.map((block, index) => ({
        ...withBlockState(block, index),
        name: getField(block, "name", "title", "award"),
        issuer: getField(block, "issuer", "organization"),
        date: getField(block, "date"),
        description: getField(block, "description", "summary", "details")
      }));

      sections.push({
        id: `awards-${section.id}`,
        backendSectionId: section.id,
        type: "awards",
        hidden: sectionHidden,
        order: section.order,
        data: { items }
      });
      continue;
    }

    if (section.type === "publications") {
      const items: EditorItem[] = sortedBlocks.map((block, index) => ({
        ...withBlockState(block, index),
        title: getField(block, "title", "name", "publication"),
        publisher: getField(block, "publisher", "journal", "organization"),
        date: getField(block, "date"),
        description: getField(block, "description", "summary", "details")
      }));

      sections.push({
        id: `publications-${section.id}`,
        backendSectionId: section.id,
        type: "publications",
        hidden: sectionHidden,
        order: section.order,
        data: { items }
      });
      continue;
    }

    if (section.type === "references") {
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
          return [
            {
              ...withBlockState(block, index),
              name: "",
              jobTitle: "",
              organization: "",
              email: "",
              phone: ""
            }
          ];
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
        data: { items }
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
      type: section.type,
      hidden: sectionHidden,
      order: section.order,
      data: { items }
    });
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

  const metadata: Record<string, CvJsonValue> = {
    ...(existing?.metadata ?? {}),
    full_name: toJsonValue(asString(headerData.name)),
    headline: toJsonValue(asString(headerData.title)),
    email: toJsonValue(asString(headerData.email)),
    phone: toJsonValue(asString(headerData.phone)),
    location: toJsonValue(asString(headerData.location)),
    social_links: socialLinks
  };

  const bodySections = sections
    .filter((section) => section.type !== "header")
    .sort((a, b) => a.order - b.order)
    .map((section, sectionIndex) => {
      if (section.type === "summary") {
        const summaryData = asRecord(section.data);
        const text = asString(summaryData.text);
        const rawFields = toJsonRecord(summaryData.rawFields);
        const rawMeta = toJsonRecord(summaryData.rawMeta);

        const blockId =
          asString(summaryData.blockId) ||
          deterministicBlockId(
            section,
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

      if (section.type === "experience") {
        return sectionFromItems(section, sectionIndex, (item) => {
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

      if (section.type === "education") {
        return sectionFromItems(section, sectionIndex, (item) => ({
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

      if (section.type === "skills") {
        const skillValues = asStringArray(asRecord(section.data).skills);
        const sectionId = section.backendSectionId || deterministicSectionId("skills", sectionIndex);

        return {
          id: sectionId,
          type: "skills",
          title: "Skills",
          order: sectionIndex,
          meta: section.hidden ? { visibility: "hidden" } : {},
          blocks: skillValues.map((skill, index) => {
            const fallbackId = `${normalizeIdPart(sectionId) || "skills"}-skill-${index + 1}`;
            return {
              id: fallbackId,
              type: "skill",
              order: index,
              visibility: toVisibility(section.hidden),
              fields: {
                name: toJsonValue(skill)
              },
              meta: {}
            };
          })
        };
      }

      if (section.type === "languages") {
        return sectionFromItems(section, sectionIndex, (item) => ({
          type: "language_item",
          fields: {
            language: toJsonValue(asString(item.language)),
            proficiency: toJsonValue(asString(item.proficiency)),
            certificate: toJsonValue(asString(item.certificate)),
            notes: toJsonValue(asString(item.notes))
          }
        }));
      }

      if (section.type === "certifications") {
        return sectionFromItems(section, sectionIndex, (item) => ({
          type: "certification_item",
          fields: {
            name: toJsonValue(asString(item.name)),
            url: toJsonValue(asString(item.url)),
            verification_id: toJsonValue(asString(item.verificationId))
          }
        }));
      }

      if (section.type === "courses") {
        return sectionFromItems(section, sectionIndex, (item) => ({
          type: "course_item",
          fields: {
            title: toJsonValue(asString(item.title)),
            institution: toJsonValue(asString(item.institution)),
            url: toJsonValue(asString(item.url)),
            description: toJsonValue(asString(item.description))
          }
        }));
      }

      if (section.type === "projects") {
        return sectionFromItems(section, sectionIndex, (item) => ({
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

      if (section.type === "volunteer") {
        return sectionFromItems(section, sectionIndex, (item) => {
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

      if (section.type === "awards") {
        return sectionFromItems(section, sectionIndex, (item) => ({
          type: "award_item",
          fields: {
            name: toJsonValue(asString(item.name)),
            issuer: toJsonValue(asString(item.issuer)),
            date: toJsonValue(asString(item.date)),
            description: toJsonValue(asString(item.description))
          }
        }));
      }

      if (section.type === "publications") {
        return sectionFromItems(section, sectionIndex, (item) => ({
          type: "publication_item",
          fields: {
            title: toJsonValue(asString(item.title)),
            publisher: toJsonValue(asString(item.publisher)),
            date: toJsonValue(asString(item.date)),
            description: toJsonValue(asString(item.description))
          }
        }));
      }

      if (section.type === "references") {
        return sectionFromItems(section, sectionIndex, (item) => ({
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

      return sectionFromItems(section, sectionIndex, (item) => ({
        type: `${section.type || "custom"}_item`,
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
    return null;
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

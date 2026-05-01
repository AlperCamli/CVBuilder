import type { CvBlock, CvContent, CvJsonValue, CvSection } from "../../shared/cv-content/cv-content.types";

const PROFICIENCY_LEVELS = new Set(
  ["Native", "Professional", "Advanced", "Intermediate", "Basic", "Limited"].map((value) =>
    value.toLowerCase()
  )
);

const SECTION_TYPE_ALIASES: Record<string, string> = {
  header: "header",
  contact: "header",
  contacts: "header",
  contact_info: "header",
  contact_information: "header",
  personal_info: "header",
  personal_information: "header",
  personal: "header",
  summary: "summary",
  profile: "summary",
  objective: "summary",
  about: "summary",
  experience: "experience",
  work_experience: "experience",
  employment: "experience",
  professional_experience: "experience",
  education: "education",
  skill: "skills",
  skills: "skills",
  language: "languages",
  languages: "languages",
  certification: "certifications",
  certifications: "certifications",
  certificate: "certifications",
  certificates: "certifications",
  course: "courses",
  courses: "courses",
  training: "courses",
  trainings: "courses",
  project: "projects",
  projects: "projects",
  volunteer: "volunteer",
  volunteer_work: "volunteer",
  volunteering: "volunteer",
  award: "awards",
  awards: "awards",
  honor: "awards",
  honors: "awards",
  publication: "publications",
  publications: "publications",
  reference: "references",
  references: "references",
  referee: "references",
  referees: "references"
};

interface ParsedLanguageEntry {
  language: string;
  proficiency: string;
  certificate: string;
  notes: string;
}

interface CanonicalSocialLink {
  id: string;
  type: string;
  url: string;
}

const DEGREE_HINT_PATTERN =
  /\b(bachelor|master|ph\.?d|doctor|associate|b\.?sc|m\.?sc|mba|ba|bs|diploma|certificate|licen[sc]e|high school)\b/i;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeLine = (value: string): string => value.trim();

const collapseWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const asString = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!isPlainObject(value)) {
    return {};
  }

  return value;
};

const flattenText = (value: unknown): string[] => {
  if (value === null || value === undefined) {
    return [];
  }

  if (typeof value === "string") {
    const normalized = collapseWhitespace(value);
    return normalized ? [normalized] : [];
  }

  if (typeof value === "number") {
    return [String(value)];
  }

  if (typeof value === "boolean") {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenText(item));
  }

  if (isPlainObject(value)) {
    return Object.values(value).flatMap((item) => flattenText(item));
  }

  return [];
};

const firstNonEmpty = (...values: string[]): string | null => {
  for (const value of values) {
    const normalized = collapseWhitespace(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((item) => flattenText(item))
    .map((item) => collapseWhitespace(item))
    .filter((item) => item.length > 0);
};

const toStringValues = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return asStringArray(value);
  }

  return flattenText(value)
    .map((item) => collapseWhitespace(item))
    .filter((item) => item.length > 0);
};

const dedupeByLowercase = (items: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const item of items) {
    const normalized = collapseWhitespace(item);
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

const normalizeSectionType = (value: string): string => {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return SECTION_TYPE_ALIASES[normalized] ?? (normalized || "custom");
};

const isKnownProficiency = (value: string): boolean =>
  PROFICIENCY_LEVELS.has(value.trim().toLowerCase());

const normalizeUrl = (rawUrl: string): string | null => {
  const candidate = rawUrl.trim().replace(/[),.;!?]+$/g, "");
  if (!candidate) {
    return null;
  }

  if (/^(https?:\/\/|mailto:|tel:)/i.test(candidate)) {
    return candidate;
  }

  const handleMatch = candidate.match(/^(linkedin|in|github|gitlab)\/([A-Za-z0-9._-]{2,})$/i);
  if (handleMatch) {
    const platform = handleMatch[1].toLowerCase();
    const handle = handleMatch[2];

    if (platform === "linkedin" || platform === "in") {
      return `https://www.linkedin.com/in/${handle}`;
    }

    if (platform === "github") {
      return `https://github.com/${handle}`;
    }

    return `https://gitlab.com/${handle}`;
  }

  if (/^linkedin\.com\//i.test(candidate)) {
    return `https://www.${candidate.replace(/^linkedin\.com\//i, "linkedin.com/")}`;
  }

  if (/^(github|gitlab)\.com\//i.test(candidate)) {
    return `https://${candidate}`;
  }

  if (/^www\./i.test(candidate)) {
    return `https://${candidate}`;
  }

  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/\S*)?$/i.test(candidate)) {
    return `https://${candidate}`;
  }

  return null;
};

const detectSocialType = (url: string, keyHint?: string): string => {
  const hint = keyHint?.toLowerCase() ?? "";
  if (hint.includes("linkedin")) {
    return "linkedin";
  }
  if (hint.includes("github")) {
    return "github";
  }
  if (hint.includes("gitlab")) {
    return "gitlab";
  }
  if (hint.includes("portfolio")) {
    return "portfolio";
  }

  const normalizedUrl = url.toLowerCase();
  if (normalizedUrl.includes("linkedin.com")) {
    return "linkedin";
  }
  if (normalizedUrl.includes("github.com")) {
    return "github";
  }
  if (normalizedUrl.includes("gitlab.com")) {
    return "gitlab";
  }

  return "website";
};

const toSocialLink = (
  value: unknown,
  index: number,
  keyHint?: string
): CanonicalSocialLink | null => {
  if (typeof value === "string" || typeof value === "number") {
    const url = normalizeUrl(String(value));
    if (!url) {
      return null;
    }
    return {
      id: `social-${index + 1}`,
      type: detectSocialType(url, keyHint),
      url
    };
  }

  const record = asRecord(value);
  const url = normalizeUrl(asString(record.url));
  if (!url) {
    return null;
  }

  return {
    id: collapseWhitespace(asString(record.id)) || `social-${index + 1}`,
    type: collapseWhitespace(asString(record.type)) || detectSocialType(url, keyHint),
    url
  };
};

const dedupeSocialLinks = (links: CanonicalSocialLink[]): CanonicalSocialLink[] => {
  const seen = new Set<string>();
  const output: CanonicalSocialLink[] = [];

  for (const link of links) {
    const key = link.url.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(link);
  }

  return output;
};

const getFieldValue = (fields: Record<string, CvJsonValue>, keys: string[]): string | null => {
  for (const key of keys) {
    if (!(key in fields)) {
      continue;
    }

    const values = flattenText(fields[key]);
    if (values.length > 0) {
      return values.join(", ");
    }
  }

  return null;
};

const parseLanguageEntries = (text: string): ParsedLanguageEntry[] => {
  const normalizedText = collapseWhitespace(text);
  if (!normalizedText) {
    return [];
  }

  return normalizedText
    .split(/[,;\n]+/)
    .map((item) => collapseWhitespace(item))
    .filter((item) => item.length > 0)
    .map((item) => {
      const bracketMatch = item.match(/^(.+?)\s*\(([^)]+)\)$/);
      if (bracketMatch) {
        const language = collapseWhitespace(bracketMatch[1]);
        const detail = collapseWhitespace(bracketMatch[2]);
        const proficiency = isKnownProficiency(detail) ? detail : "";
        const certificate = proficiency ? "" : detail;

        return {
          language,
          proficiency,
          certificate,
          notes: ""
        };
      }

      const separatorMatch = item.match(/^(.+?)\s*[-–—:]\s*(.+)$/);
      if (separatorMatch) {
        const language = collapseWhitespace(separatorMatch[1]);
        const detail = collapseWhitespace(separatorMatch[2]);
        const proficiency = isKnownProficiency(detail) ? detail : "";
        const certificate = proficiency ? "" : detail;

        return {
          language,
          proficiency,
          certificate,
          notes: ""
        };
      }

      return {
        language: item,
        proficiency: "",
        certificate: "",
        notes: ""
      };
    })
    .filter((entry) => entry.language.length > 0);
};

const uniqueBlockId = (preferredId: string, usedIds: Set<string>): string => {
  const base = preferredId.trim() || "block";
  if (!usedIds.has(base)) {
    usedIds.add(base);
    return base;
  }

  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (usedIds.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  usedIds.add(candidate);
  return candidate;
};

const canonicalizeAwardFields = (
  fields: Record<string, CvJsonValue>
): Record<string, CvJsonValue> => {
  const next = { ...fields };
  const issuer = firstNonEmpty(
    getFieldValue(fields, ["issuer"]) ?? "",
    getFieldValue(fields, ["issuing_organization"]) ?? "",
    getFieldValue(fields, ["organization"]) ?? ""
  );

  if (issuer) {
    next.issuer = issuer;
  }

  return next;
};

const canonicalizeEducationFields = (
  fields: Record<string, CvJsonValue>
): Record<string, CvJsonValue> => {
  const next = { ...fields };

  const institution = firstNonEmpty(
    getFieldValue(fields, ["institution"]) ?? "",
    getFieldValue(fields, ["school"]) ?? "",
    getFieldValue(fields, ["university"]) ?? "",
    getFieldValue(fields, ["college"]) ?? ""
  );
  const degree = firstNonEmpty(
    getFieldValue(fields, ["degree"]) ?? "",
    getFieldValue(fields, ["qualification"]) ?? "",
    getFieldValue(fields, ["title"]) ?? ""
  );
  const fieldOfStudy = firstNonEmpty(
    getFieldValue(fields, ["field_of_study"]) ?? "",
    getFieldValue(fields, ["major"]) ?? "",
    getFieldValue(fields, ["field"]) ?? "",
    getFieldValue(fields, ["program"]) ?? "",
    getFieldValue(fields, ["specialization"]) ?? "",
    getFieldValue(fields, ["focus"]) ?? ""
  );
  const startDate = firstNonEmpty(
    getFieldValue(fields, ["start_date"]) ?? "",
    getFieldValue(fields, ["start"]) ?? "",
    getFieldValue(fields, ["from"]) ?? "",
    getFieldValue(fields, ["from_date"]) ?? ""
  );
  const endDate = firstNonEmpty(
    getFieldValue(fields, ["end_date"]) ?? "",
    getFieldValue(fields, ["end"]) ?? "",
    getFieldValue(fields, ["to"]) ?? "",
    getFieldValue(fields, ["to_date"]) ?? "",
    getFieldValue(fields, ["graduation_date"]) ?? ""
  );
  const description = firstNonEmpty(
    getFieldValue(fields, ["description"]) ?? "",
    getFieldValue(fields, ["details"]) ?? "",
    getFieldValue(fields, ["notes"]) ?? ""
  );

  if (institution) {
    next.institution = institution;
  }
  if (degree) {
    next.degree = degree;
  }
  if (startDate) {
    next.start_date = startDate;
  }
  if (endDate) {
    next.end_date = endDate;
  }
  if (description) {
    next.description = description;
  }

  if (fieldOfStudy) {
    next.field_of_study = fieldOfStudy;
  } else if (degree && !DEGREE_HINT_PATTERN.test(degree)) {
    // If degree is likely a subject (e.g. "Computer Science"), preserve it as field_of_study.
    next.field_of_study = degree;
  }

  return next;
};

const parseExperienceHeader = (value: string): { role: string; company: string } => {
  const text = collapseWhitespace(value);
  if (!text) {
    return { role: "", company: "" };
  }

  const atMatch = text.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
  if (atMatch) {
    return {
      role: collapseWhitespace(atMatch[1]),
      company: collapseWhitespace(atMatch[2])
    };
  }

  const dashMatch = text.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dashMatch) {
    return {
      role: collapseWhitespace(dashMatch[1]),
      company: collapseWhitespace(dashMatch[2])
    };
  }

  return { role: "", company: "" };
};

const canonicalizeExperienceFields = (
  fields: Record<string, CvJsonValue>
): Record<string, CvJsonValue> => {
  const next = { ...fields };

  let role = firstNonEmpty(
    getFieldValue(fields, ["role"]) ?? "",
    getFieldValue(fields, ["job_title"]) ?? "",
    getFieldValue(fields, ["jobTitle"]) ?? "",
    getFieldValue(fields, ["position"]) ?? "",
    getFieldValue(fields, ["position_title"]) ?? "",
    getFieldValue(fields, ["designation"]) ?? "",
    getFieldValue(fields, ["title"]) ?? "",
    getFieldValue(fields, ["headline"]) ?? ""
  );
  let company = firstNonEmpty(
    getFieldValue(fields, ["company"]) ?? "",
    getFieldValue(fields, ["company_name"]) ?? "",
    getFieldValue(fields, ["employer"]) ?? "",
    getFieldValue(fields, ["organization"]) ?? "",
    getFieldValue(fields, ["organization_name"]) ?? ""
  );
  const location = firstNonEmpty(
    getFieldValue(fields, ["location"]) ?? "",
    getFieldValue(fields, ["city"]) ?? "",
    getFieldValue(fields, ["country"]) ?? ""
  );
  const startDate = firstNonEmpty(
    getFieldValue(fields, ["start_date"]) ?? "",
    getFieldValue(fields, ["start"]) ?? "",
    getFieldValue(fields, ["from"]) ?? "",
    getFieldValue(fields, ["from_date"]) ?? ""
  );
  const endDate = firstNonEmpty(
    getFieldValue(fields, ["end_date"]) ?? "",
    getFieldValue(fields, ["end"]) ?? "",
    getFieldValue(fields, ["to"]) ?? "",
    getFieldValue(fields, ["to_date"]) ?? "",
    getFieldValue(fields, ["until"]) ?? ""
  );
  const description = firstNonEmpty(
    getFieldValue(fields, ["description"]) ?? "",
    getFieldValue(fields, ["summary"]) ?? "",
    getFieldValue(fields, ["details"]) ?? "",
    getFieldValue(fields, ["responsibilities"]) ?? "",
    getFieldValue(fields, ["highlights"]) ?? "",
    getFieldValue(fields, ["notes"]) ?? ""
  );

  const headerText = firstNonEmpty(
    getFieldValue(fields, ["text"]) ?? "",
    getFieldValue(fields, ["header"]) ?? ""
  );
  if (headerText && (!role || !company)) {
    const parsedHeader = parseExperienceHeader(headerText);
    role = firstNonEmpty(role ?? "", parsedHeader.role);
    company = firstNonEmpty(company ?? "", parsedHeader.company);
  }

  if (role) {
    next.role = role;
  }
  if (company) {
    next.company = company;
  }
  if (location) {
    next.location = location;
  }
  if (startDate) {
    next.start_date = startDate;
  }
  if (endDate) {
    next.end_date = endDate;
  }
  if (description) {
    next.description = description;
  }

  return next;
};

const canonicalizeLanguageBlock = (
  block: CvBlock,
  fields: Record<string, CvJsonValue>,
  usedIds: Set<string>
): CvBlock[] => {
  const language = normalizeLine(asString(fields.language));
  const proficiency = normalizeLine(asString(fields.proficiency));
  const certificate = normalizeLine(asString(fields.certificate));

  if (language) {
    const nextFields = { ...fields };
    if (proficiency && !isKnownProficiency(proficiency) && !certificate) {
      nextFields.proficiency = "";
      nextFields.certificate = proficiency;
    }

    return [
      {
        ...block,
        fields: nextFields
      }
    ];
  }

  const text = firstNonEmpty(getFieldValue(fields, ["text"]) ?? "");
  if (!text) {
    return [{ ...block, fields }];
  }

  const entries = parseLanguageEntries(text);
  if (entries.length === 0) {
    return [{ ...block, fields }];
  }

  const [primary, ...rest] = entries;
  const nextBlocks: CvBlock[] = [
    {
      ...block,
      fields: {
        ...fields,
        language: primary.language,
        proficiency: primary.proficiency,
        certificate: primary.certificate,
        notes: primary.notes
      }
    }
  ];

  for (const [index, entry] of rest.entries()) {
    nextBlocks.push({
      ...block,
      id: uniqueBlockId(`${block.id}-lang-${index + 2}`, usedIds),
      type: "language_item",
      fields: {
        language: entry.language,
        proficiency: entry.proficiency,
        certificate: entry.certificate,
        notes: entry.notes
      }
    });
  }

  return nextBlocks;
};

const canonicalizeSections = (sections: CvSection[]): CvSection[] => {
  const usedBlockIds = new Set<string>(sections.flatMap((section) => section.blocks.map((block) => block.id)));

  return sections.map((section) => {
    const sectionType = normalizeSectionType(section.type);
    const nextBlocks: CvBlock[] = [];

    for (const block of section.blocks) {
      const baseFields = { ...block.fields };
      const fields =
        sectionType === "awards"
          ? canonicalizeAwardFields(baseFields)
          : sectionType === "education"
            ? canonicalizeEducationFields(baseFields)
            : sectionType === "experience"
              ? canonicalizeExperienceFields(baseFields)
              : baseFields;

      if (sectionType === "languages") {
        nextBlocks.push(...canonicalizeLanguageBlock(block, fields, usedBlockIds));
      } else {
        nextBlocks.push({
          ...block,
          fields
        });
      }
    }

    return {
      ...section,
      type: sectionType,
      blocks: nextBlocks.map((block, index) => ({
        ...block,
        order: index
      }))
    };
  });
};

const collectMetadataSocialLinks = (metadata: Record<string, CvJsonValue>): CanonicalSocialLink[] => {
  const links: CanonicalSocialLink[] = [];
  const socialLinks = Array.isArray(metadata.social_links) ? metadata.social_links : [];
  const urls = Array.isArray(metadata.urls) ? metadata.urls : [];

  for (const [index, value] of socialLinks.entries()) {
    const link = toSocialLink(value, index);
    if (link) {
      links.push(link);
    }
  }

  for (const [index, value] of urls.entries()) {
    const link = toSocialLink(value, links.length + index);
    if (link) {
      links.push(link);
    }
  }

  const keyMappings: Array<{ key: string; type: string }> = [
    { key: "github", type: "github" },
    { key: "linkedin", type: "linkedin" },
    { key: "website", type: "website" },
    { key: "portfolio", type: "portfolio" }
  ];

  for (const mapping of keyMappings) {
    if (!(mapping.key in metadata)) {
      continue;
    }

    const values = toStringValues(metadata[mapping.key]);
    for (const value of values) {
      const url = normalizeUrl(value);
      if (!url) {
        continue;
      }

      links.push({
        id: `social-${links.length + 1}`,
        type: mapping.type,
        url
      });
    }
  }

  return dedupeSocialLinks(links);
};

const collectHeaderBlocks = (sections: CvSection[]): CvBlock[] =>
  sections
    .filter((section) => section.type === "header")
    .flatMap((section) => section.blocks)
    .sort((left, right) => left.order - right.order);

const extractHeaderSocialLinks = (headerBlocks: CvBlock[]): CanonicalSocialLink[] => {
  const links: CanonicalSocialLink[] = [];

  for (const block of headerBlocks) {
    const fields = block.fields;
    const urls = asStringArray(fields.urls);
    for (const value of urls) {
      const url = normalizeUrl(value);
      if (!url) {
        continue;
      }
      links.push({
        id: `social-${links.length + 1}`,
        type: detectSocialType(url),
        url
      });
    }

    const mappings: Array<{ keys: string[]; type: string }> = [
      { keys: ["linkedin"], type: "linkedin" },
      { keys: ["github"], type: "github" },
      { keys: ["gitlab"], type: "gitlab" },
      { keys: ["website", "portfolio"], type: "website" }
    ];

    for (const mapping of mappings) {
      const text = firstNonEmpty(...mapping.keys.map((key) => getFieldValue(fields, [key]) ?? ""));
      if (!text) {
        continue;
      }

      for (const value of toStringValues(text)) {
        const url = normalizeUrl(value);
        if (!url) {
          continue;
        }
        links.push({
          id: `social-${links.length + 1}`,
          type: mapping.type,
          url
        });
      }
    }
  }

  return dedupeSocialLinks(links);
};

const getHeaderField = (headerBlocks: CvBlock[], keys: string[]): string | null => {
  for (const block of headerBlocks) {
    const value = firstNonEmpty(...keys.map((key) => getFieldValue(block.fields, [key]) ?? ""));
    if (value) {
      return value;
    }
  }

  return null;
};

const toSocialLinkJson = (links: CanonicalSocialLink[]): CvJsonValue => {
  return links.map((link) => ({
    id: link.id,
    type: link.type,
    url: link.url
  }));
};

const canonicalizeMetadata = (
  metadata: Record<string, CvJsonValue>,
  sections: CvSection[]
): Record<string, CvJsonValue> => {
  const next: Record<string, CvJsonValue> = { ...metadata };
  const headerBlocks = collectHeaderBlocks(sections);

  const fullName = firstNonEmpty(
    asString(metadata.full_name),
    asString(metadata.name),
    getHeaderField(headerBlocks, ["full_name", "name"]) ?? ""
  );
  if (fullName) {
    next.full_name = fullName;
  }

  const headline = firstNonEmpty(
    asString(metadata.headline),
    asString(metadata.title),
    asString(metadata.job_title),
    getHeaderField(headerBlocks, ["headline", "title", "job_title"]) ?? ""
  );
  if (headline) {
    next.headline = headline;
  }

  const email = firstNonEmpty(
    asString(metadata.email),
    getHeaderField(headerBlocks, ["email"]) ?? ""
  );
  if (email) {
    next.email = email;
  }

  const phone = firstNonEmpty(
    asString(metadata.phone),
    asString(metadata.phone_number),
    getHeaderField(headerBlocks, ["phone", "phone_number"]) ?? ""
  );
  if (phone) {
    next.phone = phone;
  }

  const location = firstNonEmpty(
    asString(metadata.location),
    getHeaderField(headerBlocks, ["location", "city", "country"]) ?? ""
  );
  if (location) {
    next.location = location;
  }

  const photo = firstNonEmpty(
    asString(metadata.photo),
    getHeaderField(headerBlocks, ["photo", "avatar"]) ?? ""
  );
  if (photo) {
    next.photo = photo;
  }

  const links = dedupeSocialLinks([
    ...collectMetadataSocialLinks(metadata),
    ...extractHeaderSocialLinks(headerBlocks)
  ]);

  if (links.length > 0) {
    next.social_links = toSocialLinkJson(links);
    next.urls = links.map((link) => link.url);
  }

  return next;
};

export const canonicalizeImportedCvContent = (content: CvContent): CvContent => {
  const sections = canonicalizeSections(content.sections);
  const metadata = canonicalizeMetadata(content.metadata, sections);

  return {
    ...content,
    metadata,
    sections
  };
};

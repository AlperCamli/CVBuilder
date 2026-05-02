const asRecord = (value: unknown): Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

const asTrimmedString = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

const firstNonEmpty = (...values: unknown[]): string => {
  for (const value of values) {
    const text = asTrimmedString(value);
    if (text) {
      return text;
    }
  }
  return "";
};

const slugify = (value: string): string => {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
};

const SECTION_TYPE_ALIASES: Record<string, string> = {
  contact: "header",
  contact_info: "header",
  contact_information: "header",
  employment: "experience",
  header: "header",
  language: "languages",
  personal_info: "header",
  personal_information: "header",
  professional_experience: "experience",
  profile: "header",
  work_experience: "experience"
};

const GENERIC_SECTION_TYPE_PATTERN = /^section[_-]?\d+$/i;

const SECTION_STRUCTURAL_KEYS = new Set([
  "id",
  "type",
  "section_type",
  "kind",
  "name",
  "label",
  "title",
  "order",
  "blocks",
  "block",
  "items",
  "entries",
  "meta"
]);

const BLOCK_STRUCTURAL_KEYS = new Set([
  "id",
  "type",
  "block_type",
  "kind",
  "order",
  "visibility",
  "fields",
  "meta"
]);

const isMeaningfulScalar = (value: unknown): boolean => {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (typeof value === "boolean") {
    return true;
  }
  return value !== null && value !== undefined;
};

const isGenericSectionType = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return normalized === "custom" || GENERIC_SECTION_TYPE_PATTERN.test(normalized);
};

const extractLooseFields = (
  source: Record<string, unknown>,
  structuralKeys: Set<string>
): Record<string, unknown> => {
  const fields: Record<string, unknown> = {};

  for (const [key, rawValue] of Object.entries(source)) {
    if (structuralKeys.has(key)) {
      continue;
    }
    if (key.startsWith("_")) {
      continue;
    }

    if (Array.isArray(rawValue)) {
      if (rawValue.length > 0) {
        fields[key] = rawValue;
      }
      continue;
    }

    if (typeof rawValue === "object" && rawValue !== null) {
      fields[key] = rawValue;
      continue;
    }

    if (isMeaningfulScalar(rawValue)) {
      fields[key] = rawValue;
    }
  }

  return fields;
};

const resolveSectionType = (section: Record<string, unknown>, index: number): string => {
  const rawType =
    firstNonEmpty(
      section.type,
      section.section_type,
      section.kind,
      asRecord(section.meta).type,
      section.name,
      section.label,
      section.title
    ) || "custom";

  const slug = slugify(rawType) || "custom";
  return SECTION_TYPE_ALIASES[slug] ?? slug;
};

const inferSectionTypeFromFields = (
  section: Record<string, unknown>,
  blocks: Array<Record<string, unknown>>
): string | null => {
  const fieldKeys = new Set<string>();

  for (const [key, value] of Object.entries(section)) {
    if (SECTION_STRUCTURAL_KEYS.has(key)) {
      continue;
    }
    if (isMeaningfulScalar(value) || Array.isArray(value) || (typeof value === "object" && value !== null)) {
      fieldKeys.add(key.toLowerCase());
    }
  }

  for (const block of blocks) {
    const fields = asRecord(block.fields);
    for (const key of Object.keys(fields)) {
      fieldKeys.add(key.toLowerCase());
    }
  }

  const hasAny = (keys: string[]): boolean => keys.some((key) => fieldKeys.has(key));
  const hasHeaderSignals =
    hasAny(["full_name", "name", "email", "phone", "location", "github", "linkedin", "social_links", "urls"]) &&
    hasAny(["email", "phone", "location"]);
  if (hasHeaderSignals) {
    return "header";
  }

  if (hasAny(["institution", "school", "university", "degree", "field_of_study", "major", "gpa"])) {
    return "education";
  }

  if (hasAny(["role", "company", "organization", "employer", "responsibilities", "achievements"])) {
    return "experience";
  }

  if (hasAny(["language", "proficiency", "level", "certificate", "score"])) {
    return "languages";
  }

  if (hasAny(["skills", "skill", "tools", "technologies", "stack"])) {
    return "skills";
  }

  if (hasAny(["issuer", "award", "awarded_by"])) {
    return "awards";
  }

  if (hasAny(["reference_name", "referee", "relationship"]) && hasAny(["email", "phone"])) {
    return "references";
  }

  return null;
};

const resolveBlockType = (block: Record<string, unknown>, fallbackSectionType: string): string => {
  const raw = firstNonEmpty(
    block.type,
    block.block_type,
    block.kind,
    asRecord(block.meta).type,
    fallbackSectionType
  );

  const slug = slugify(raw);
  if (slug) {
    return slug;
  }
  if (fallbackSectionType === "summary") {
    return "summary";
  }
  if (fallbackSectionType === "header") {
    return "contact";
  }
  return "text";
};

const coerceBlockFields = (block: Record<string, unknown>): Record<string, unknown> => {
  const blockFields = asRecord(block.fields);
  if (Object.keys(blockFields).length > 0) {
    return blockFields;
  }

  const looseFields = extractLooseFields(block, BLOCK_STRUCTURAL_KEYS);
  if (Object.keys(looseFields).length > 0) {
    return looseFields;
  }

  const fallbackText = firstNonEmpty(
    block.text,
    block.content,
    block.description,
    block.summary,
    block.details,
    block.title,
    block.subtitle
  );
  if (fallbackText) {
    return { text: fallbackText };
  }

  return {};
};

const coerceBlock = (
  value: unknown,
  fallbackSectionType: string,
  index: number
): Record<string, unknown> => {
  if (typeof value === "string") {
    const text = value.trim();
    return {
      type: "text",
      order: index,
      fields: text ? { text } : {}
    };
  }

  const block = asRecord(value);
  return {
    ...block,
    type: resolveBlockType(block, fallbackSectionType),
    order: Number.isInteger(block.order) ? Number(block.order) : index,
    fields: coerceBlockFields(block)
  };
};

const deriveSectionFallbackBlock = (
  section: Record<string, unknown>,
  sectionType: string
): Record<string, unknown> => {
  const looseFields = extractLooseFields(section, SECTION_STRUCTURAL_KEYS);
  if (Object.keys(looseFields).length > 0) {
    return {
      type: resolveBlockType({}, sectionType),
      order: 0,
      fields: looseFields
    };
  }

  const fallbackText = firstNonEmpty(
    section.content,
    section.description,
    section.summary,
    section.text,
    section.title,
    section.label
  );

  return {
    type: resolveBlockType({}, sectionType),
    order: 0,
    fields: fallbackText ? { text: fallbackText } : {}
  };
};

const coerceSection = (value: unknown, index: number): Record<string, unknown> => {
  const section = asRecord(value);
  const sectionType = resolveSectionType(section, index);
  const sectionOrder = Number.isInteger(section.order) ? Number(section.order) : index;

  const sectionItems =
    Array.isArray(section.blocks)
      ? section.blocks
      : Array.isArray(section.items)
        ? section.items
        : Array.isArray(section.entries)
          ? section.entries
          : section.block !== undefined
            ? [section.block]
            : [];

  const coercedBlocks = sectionItems
    .map((item, blockIndex) => coerceBlock(item, sectionType, blockIndex))
    .filter((item) => Object.keys(asRecord(item.fields)).length > 0);

  const blocks =
    coercedBlocks.length > 0
      ? coercedBlocks
      : [deriveSectionFallbackBlock(section, sectionType)];

  const inferredType =
    isGenericSectionType(sectionType) ? inferSectionTypeFromFields(section, blocks) : null;
  const finalSectionType = inferredType ?? sectionType;

  return {
    ...section,
    type: finalSectionType,
    order: sectionOrder,
    blocks
  };
};

export const coerceTailoredDraftOutputPayload = (
  outputPayload: Record<string, unknown>
): Record<string, unknown> => {
  const currentContent = asRecord(outputPayload.current_content);
  if (Object.keys(currentContent).length === 0) {
    return outputPayload;
  }

  const sections = Array.isArray(currentContent.sections) ? currentContent.sections : [];
  const normalizedSections = sections.map((section, sectionIndex) =>
    coerceSection(section, sectionIndex)
  );

  return {
    ...outputPayload,
    current_content: {
      ...currentContent,
      sections: normalizedSections
    }
  };
};

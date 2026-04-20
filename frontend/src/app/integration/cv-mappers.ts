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

      sections.push({
        id: `summary-${section.id}`,
        backendSectionId: section.id,
        type: "summary",
        hidden: sectionHidden,
        order: section.order,
        data: {
          text: block ? getField(block, "text", "summary", "description") : "",
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
        const startDate = getField(block, "start_date", "start");
        const endDate = getField(block, "end_date", "end");

        return {
          ...withBlockState(block, index),
          company: getField(block, "company", "organization"),
          role: getField(block, "role", "position", "title", "headline"),
          country: getField(block, "location", "country", "city"),
          startDate,
          endDate,
          currentRole: asBoolean(block.fields.current_role) || endDate.toLowerCase() === "present",
          dates: buildDates(startDate, endDate),
          description: getField(block, "description", "summary", "highlights", "responsibilities")
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
        const startDate = getField(block, "start_date", "start");
        const endDate = getField(block, "end_date", "end");

        return {
          ...withBlockState(block, index),
          institution: getField(block, "institution", "school", "university"),
          degree: getField(block, "degree", "title"),
          fieldOfStudy: getField(block, "field_of_study", "major"),
          gpa: getField(block, "gpa"),
          startDate,
          endDate,
          expectedGraduation:
            asBoolean(block.fields.expected_graduation) || asBoolean(block.fields.expectedGraduation),
          exchangeProgram:
            asBoolean(block.fields.exchange_program) || asBoolean(block.fields.exchangeProgram),
          description: getField(block, "description", "notes")
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
      const items: EditorItem[] = sortedBlocks.map((block, index) => ({
        ...withBlockState(block, index),
        language: getField(block, "language", "name", "title"),
        proficiency: getField(block, "proficiency", "level", "fluency"),
        certificate: getField(block, "certificate", "score", "certification"),
        notes: getField(block, "notes", "description", "details")
      }));

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
        const startDate = getField(block, "start_date", "start");
        const endDate = getField(block, "end_date", "end");

        return {
          ...withBlockState(block, index),
          organization: getField(block, "organization", "company"),
          role: getField(block, "role", "position", "title"),
          country: getField(block, "location", "country", "city"),
          startDate,
          endDate,
          currentRole: asBoolean(block.fields.current_role) || endDate.toLowerCase() === "present",
          description: getField(block, "description", "summary", "details")
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
      const items: EditorItem[] = sortedBlocks.map((block, index) => ({
        ...withBlockState(block, index),
        name: getField(block, "name", "full_name"),
        jobTitle: getField(block, "job_title", "title", "role"),
        organization: getField(block, "organization", "company"),
        email: getField(block, "email"),
        phone: getField(block, "phone", "phone_number")
      }));

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

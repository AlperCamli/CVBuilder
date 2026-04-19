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
  hidden?: boolean;
  [key: string]: unknown;
}

const randomId = (prefix: string): string =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

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
    return value.toLowerCase() === "true";
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
          blockId: block?.id
        }
      });
      continue;
    }

    if (section.type === "experience") {
      const items: EditorItem[] = sortedBlocks.map((block, index) => {
        const startDate = getField(block, "start_date", "start");
        const endDate = getField(block, "end_date", "end");
        return {
          id: `${block.id}-${index}`,
          blockId: block.id,
          hidden: block.visibility === "hidden",
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
          id: `${block.id}-${index}`,
          blockId: block.id,
          hidden: block.visibility === "hidden",
          institution: getField(block, "institution", "school", "university"),
          degree: getField(block, "degree", "title"),
          fieldOfStudy: getField(block, "field_of_study", "major"),
          gpa: getField(block, "gpa"),
          startDate,
          endDate,
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
          const arrays = [
            ...asStringArray(block.fields.skills),
            ...asStringArray(block.fields.items)
          ];
          return [...direct, ...arrays];
        })
        .filter((skill) => skill.trim().length > 0);

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

    const items: EditorItem[] = sortedBlocks.map((block, index) => {
      const startDate = getField(block, "start_date", "start");
      const endDate = getField(block, "end_date", "end");
      return {
        id: `${block.id}-${index}`,
        blockId: block.id,
        hidden: block.visibility === "hidden",
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

const toJsonValue = (value: unknown): CvJsonValue => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
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

const normalizeItems = (value: unknown): EditorItem[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((entry, index) => {
    const record = asRecord(entry);
    return {
      id: asString(record.id) || randomId(`item-${index}`),
      ...record
    };
  });
};

const sectionFromItems = (
  section: EditorSection,
  typeFallback: string,
  mapItem: (item: EditorItem, index: number) => CvBlock
): CvSection => {
  const items = normalizeItems(section.data.items);
  const blocks = items.map((item, index) => {
    const block = mapItem(item, index);
    if (section.hidden) {
      return { ...block, visibility: "hidden" as const };
    }
    return block;
  });

  return {
    id: section.backendSectionId || randomId(section.type || typeFallback),
    type: section.type || typeFallback,
    title: section.type ? section.type.charAt(0).toUpperCase() + section.type.slice(1) : null,
    order: section.order,
    meta: section.hidden ? { visibility: "hidden" } : {},
    blocks
  };
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
        const text = asString(asRecord(section.data).text);
        const blockId = asString(asRecord(section.data).blockId) || randomId("summary");
        return {
          id: section.backendSectionId || randomId("summary"),
          type: "summary",
          title: "Summary",
          order: sectionIndex,
          meta: section.hidden ? { visibility: "hidden" } : {},
          blocks: [
            {
              id: blockId,
              type: "summary",
              order: 0,
              visibility: toVisibility(section.hidden),
              fields: {
                text: toJsonValue(text)
              },
              meta: {}
            }
          ]
        } as CvSection;
      }

      if (section.type === "experience") {
        return sectionFromItems(section, "experience", (item, index) => ({
          id: asString(item.blockId) || randomId("experience"),
          type: "experience_item",
          order: index,
          visibility: toVisibility(Boolean(item.hidden)),
          fields: {
            company: toJsonValue(asString(item.company)),
            role: toJsonValue(asString(item.role)),
            location: toJsonValue(asString(item.country)),
            start_date: toJsonValue(asString(item.startDate)),
            end_date: toJsonValue(asString(item.currentRole) ? "Present" : asString(item.endDate)),
            current_role: toJsonValue(Boolean(item.currentRole)),
            description: toJsonValue(asString(item.description))
          },
          meta: {}
        }));
      }

      if (section.type === "education") {
        return sectionFromItems(section, "education", (item, index) => ({
          id: asString(item.blockId) || randomId("education"),
          type: "education_item",
          order: index,
          visibility: toVisibility(Boolean(item.hidden)),
          fields: {
            institution: toJsonValue(asString(item.institution)),
            degree: toJsonValue(asString(item.degree)),
            field_of_study: toJsonValue(asString(item.fieldOfStudy)),
            gpa: toJsonValue(asString(item.gpa)),
            start_date: toJsonValue(asString(item.startDate)),
            end_date: toJsonValue(asString(item.endDate)),
            description: toJsonValue(asString(item.description))
          },
          meta: {}
        }));
      }

      if (section.type === "skills") {
        const skillValues = asStringArray(asRecord(section.data).skills);
        return {
          id: section.backendSectionId || randomId("skills"),
          type: "skills",
          title: "Skills",
          order: sectionIndex,
          meta: section.hidden ? { visibility: "hidden" } : {},
          blocks: skillValues.map((skill, index) => ({
            id: randomId("skill"),
            type: "skill",
            order: index,
            visibility: toVisibility(section.hidden),
            fields: {
              name: toJsonValue(skill)
            },
            meta: {}
          }))
        };
      }

      return sectionFromItems(section, section.type || "custom", (item, index) => ({
        id: asString(item.blockId) || randomId(section.type || "custom"),
        type: `${section.type || "custom"}_item`,
        order: index,
        visibility: toVisibility(Boolean(item.hidden)),
        fields: {
          title: toJsonValue(asString(item.title)),
          subtitle: toJsonValue(asString(item.subtitle)),
          description: toJsonValue(asString(item.description)),
          date: toJsonValue(asString(item.dates))
        },
        meta: {}
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

  const items = normalizeItems(section.data.items);
  for (const item of items) {
    const blockId = asString(item.blockId);
    if (blockId) {
      return blockId;
    }
  }

  return null;
};

import type { CvContent } from "../integration/api-types";

/** Whether parsed content holds any text; the placeholder of an unreadable image CV holds none. */
export function hasCvText(content: CvContent | null | undefined): boolean {
  const filled = (value: unknown): boolean =>
    typeof value === "string" ? value.trim().length > 0 : Array.isArray(value) ? value.some(filled) : value !== null && typeof value === "object" ? Object.values(value).some(filled) : false;
  return Boolean(content?.sections.some(section => section.blocks.some(block => filled(block.fields))));
}

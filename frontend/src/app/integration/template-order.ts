import balancedOrder from "./template-balanced-order.json";

export const BALANCED_TEMPLATE_ORDER: readonly string[] = balancedOrder;
const rank = new Map(BALANCED_TEMPLATE_ORDER.map((slug, index) => [slug, index]));

// Keep new or module-specific templates available after the curated standard set.
export function sortTemplatesForGallery<T extends { slug: string; name: string }>(templates: readonly T[]): T[] {
  return [...templates].sort((a, b) =>
    (rank.get(a.slug) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.slug) ?? Number.MAX_SAFE_INTEGER) ||
    a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug)
  );
}

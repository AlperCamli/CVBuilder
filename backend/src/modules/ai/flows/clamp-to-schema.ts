import { z, type ZodTypeAny } from "zod";

// Providers cannot enforce length/array caps (OpenAI strict mode drops maxLength/maxItems),
// so an otherwise valid answer can break a limit by a few characters. Instead of failing the
// whole run, output is clamped to the limits the schema declares:
// - lists keep their first maxItems entries;
// - a string list item that is too long is dropped (a cut keyword or bullet would be wrong);
// - any other string that is too long is cut at the last word boundary within the limit.
// Shape errors (wrong types, missing fields, too few items) pass through so the Zod contract
// still reports them.

const stringMax = (schema: z.ZodString): number | null => {
  const check = schema._def.checks.find((item) => item.kind === "max");
  return check && "value" in check ? check.value : null;
};

const unwrap = (schema: ZodTypeAny): ZodTypeAny => {
  let current = schema;
  for (;;) {
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) current = current._def.innerType;
    else if (current instanceof z.ZodDefault) current = current._def.innerType;
    else if (current instanceof z.ZodEffects) current = current._def.schema;
    else return current;
  }
};

const cutAtWord = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
};

const clamp = (schema: ZodTypeAny, value: unknown, inList: boolean): { keep: boolean; value: unknown } => {
  const inner = unwrap(schema);

  if (inner instanceof z.ZodString && typeof value === "string") {
    const trimmed = value.trim();
    const max = stringMax(inner);
    if (max === null || trimmed.length <= max) return { keep: true, value: trimmed };
    return inList ? { keep: false, value } : { keep: true, value: cutAtWord(trimmed, max) };
  }

  if (inner instanceof z.ZodArray && Array.isArray(value)) {
    const items = value
      .map((item) => clamp(inner._def.type, item, true))
      .filter((item) => item.keep)
      .map((item) => item.value);
    const max = inner._def.maxLength?.value;
    return { keep: true, value: typeof max === "number" ? items.slice(0, max) : items };
  }

  if (inner instanceof z.ZodObject && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const shape = inner.shape as Record<string, ZodTypeAny>;
    const next: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const [key, fieldSchema] of Object.entries(shape)) {
      if (key in next) next[key] = clamp(fieldSchema, next[key], false).value;
    }
    return { keep: true, value: next };
  }

  return { keep: true, value };
};

export const clampToSchemaLimits = (schema: ZodTypeAny, value: unknown): unknown => clamp(schema, value, false).value;

import type { AnalyticsRow } from "../../shared/db/analytics-db";

// Cells a spreadsheet would evaluate as a formula (CSV injection).
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

const cellText = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return FORMULA_PREFIX.test(value) ? `'${value}` : value;
  if (typeof value === "object") return cellText(JSON.stringify(value));
  return String(value);
};

// RFC 4180: quote fields containing a quote, comma or line break; double inner quotes.
const csvCell = (value: unknown): string => {
  const text = cellText(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (columns: string[], rows: AnalyticsRow[]): string => {
  const header = columns.length > 0 ? columns : Object.keys(rows[0] ?? {});
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(header.map((column) => csvCell(row[column])).join(","));
  }
  // The BOM makes Excel read the file as UTF-8 (e.g. Turkish characters).
  return `\uFEFF${lines.join("\r\n")}\r\n`;
};

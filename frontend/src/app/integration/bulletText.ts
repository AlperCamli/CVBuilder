// Shared helpers for the plain-string bullet convention used across the CV editor,
// importer, AI normalization, and rendering. A "bullet list" is a plain string where
// each bullet line is prefixed with BULLET_MARKER ("• "). Keep this file in sync with
// backend/src/shared/cv-content/bullet-text.ts.

export const BULLET_MARKER = "• ";

// A line counts as a bullet when, after optional leading whitespace, it starts with a
// bullet glyph (- * • · ▪ ◦) or a numbered prefix (1. / 1)) followed by whitespace and
// some content. Requiring the trailing space avoids matching "-5" or "well-being".
const BULLET_LINE_RE = /^\s*(?:[-*•·▪◦]+|\d+[.)])\s+\S/;

// Strips a leading bullet glyph / numbered prefix (and surrounding whitespace) from a
// single line. On a plain line it just trims leading whitespace.
const BULLET_PREFIX_RE = /^\s*(?:[-*•·▪◦]+\s*|\d+[.)]\s*)?/;

export const isBulletLine = (line: string): boolean => BULLET_LINE_RE.test(line);

export const stripBulletPrefix = (line: string): string =>
  line.replace(BULLET_PREFIX_RE, "").trim();

// Idempotent: "Hello" -> "• Hello", "• Hello" -> "• Hello", "- Hello" -> "• Hello".
export const addBulletPrefix = (line: string): string => {
  const text = stripBulletPrefix(line);
  return text ? `${BULLET_MARKER}${text}` : BULLET_MARKER.trimEnd();
};

// Converts dashes / asterisks / numbered lists / other bullet glyphs / plain newlines
// into a "• "-prefixed list. Blank lines are dropped. Returns a single \n-joined string.
export const normalizeToBullets = (text: string): string => {
  if (!text) {
    return "";
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `${BULLET_MARKER}${stripBulletPrefix(line)}`)
    .join("\n");
};

export interface SplitBulletLines {
  leadParagraph: string | null;
  bullets: string[];
}

// Splits a string into an optional leading paragraph (consecutive non-bullet lines at the
// top) and the bullet entries (marker stripped). Non-bullet lines appearing after a bullet
// are folded into the previous bullet as wrapped continuation text.
export const splitBulletLines = (text: string): SplitBulletLines => {
  const leadParts: string[] = [];
  const bullets: string[] = [];
  let seenBullet = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }

    if (isBulletLine(line)) {
      seenBullet = true;
      bullets.push(stripBulletPrefix(line));
    } else if (!seenBullet) {
      leadParts.push(line);
    } else if (bullets.length > 0) {
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${line}`.trim();
    } else {
      leadParts.push(line);
    }
  }

  return {
    leadParagraph: leadParts.length > 0 ? leadParts.join(" ") : null,
    bullets: bullets.filter((bullet) => bullet.length > 0)
  };
};

// True when every non-empty line is a bullet line (used to decide editor auto-prefixing).
export const isWholeFieldBulletList = (text: string): boolean => {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.length > 0 && lines.every((line) => isBulletLine(line));
};

// True when a value reads like a bullet-point answer (multiple lines, or any explicit
// bullet/numbered marker) rather than a single prose sentence. Used to decide whether AI
// output for a narrative field should be normalized into a "• " list.
export const looksLikeBulletAnswer = (text: string): boolean => {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  return lines.length > 1 || lines.some((line) => isBulletLine(line));
};

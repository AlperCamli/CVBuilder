// Pure string transforms behind the bullet-list textarea behavior. They take the current
// value plus the caret/selection and return the next value with the desired caret offset,
// so they can be unit-tested without a DOM. A null result means "let the browser handle
// the default key behavior".
import { BULLET_MARKER, normalizeToBullets } from "../integration/bulletText";

export interface EditResult {
  value: string;
  caret: number;
}

// Enter starts a new bullet line: insert "\n• " at the caret (replacing any selection).
export const applyEnter = (value: string, start: number, end: number): EditResult => {
  const insert = `\n${BULLET_MARKER}`;
  return {
    value: value.slice(0, start) + insert + value.slice(end),
    caret: start + insert.length
  };
};

const lineBoundsAt = (value: string, caret: number): { start: number; end: number } => {
  const start = value.lastIndexOf("\n", caret - 1) + 1;
  const newline = value.indexOf("\n", caret);
  return { start, end: newline === -1 ? value.length : newline };
};

// Backspace: first press at the marker of a bullet line strips "• " (line becomes plain);
// otherwise return null so the browser merges into the previous line / deletes a char.
export const applyBackspace = (value: string, start: number, end: number): EditResult | null => {
  if (start !== end) {
    return null;
  }

  const { start: lineStart, end: lineEnd } = lineBoundsAt(value, start);
  const lineText = value.slice(lineStart, lineEnd);
  const caretCol = start - lineStart;

  if (lineText.startsWith(BULLET_MARKER) && caretCol <= BULLET_MARKER.length) {
    const stripped = lineText.slice(BULLET_MARKER.length);
    return {
      value: value.slice(0, lineStart) + stripped + value.slice(lineEnd),
      caret: lineStart + Math.max(0, caretCol - BULLET_MARKER.length)
    };
  }

  return null;
};

// Paste: normalize the clipboard text into bullets and insert it, starting on its own line.
export const applyPaste = (
  value: string,
  start: number,
  end: number,
  clipboard: string
): EditResult | null => {
  const normalized = normalizeToBullets(clipboard);
  if (!normalized) {
    return null;
  }

  const needsLeadingNewline = start > 0 && value[start - 1] !== "\n";
  const pasted = needsLeadingNewline ? `\n${normalized}` : normalized;

  return {
    value: value.slice(0, start) + pasted + value.slice(end),
    caret: start + pasted.length
  };
};

// When the user types the first character into an empty field, seed a "• " so the whole
// field reads as a bullet list. Returns null when no seeding is needed.
export const applyAutoPrefix = (
  previousValue: string,
  nextValue: string,
  caret: number
): EditResult | null => {
  if (previousValue !== "" || nextValue === "") {
    return null;
  }

  if (nextValue.startsWith(BULLET_MARKER) || nextValue.startsWith("\n")) {
    return null;
  }

  return {
    value: BULLET_MARKER + nextValue,
    caret: caret + BULLET_MARKER.length
  };
};

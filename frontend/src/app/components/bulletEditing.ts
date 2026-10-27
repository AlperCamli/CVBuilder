// Pure string transforms behind the bullet-list textarea behavior. They take the current
// value plus the caret/selection and return the next value with the desired caret offset,
// so they can be unit-tested without a DOM. A null result means "let the browser handle
// the default key behavior".
import { BULLET_MARKER, isBulletLine, normalizeToBullets } from "../integration/bulletText";

export interface EditResult {
  value: string;
  caret: number;
}

const lineStartAt = (value: string, position: number): number =>
  value.lastIndexOf("\n", position - 1) + 1;

const lineEndAt = (value: string, position: number): number => {
  const newline = value.indexOf("\n", position);
  return newline === -1 ? value.length : newline;
};

const isEmptyBullet = (line: string): boolean => line.trim() === BULLET_MARKER.trim();

// Splits the line(s) touched by the caret/selection into the text before the caret (head)
// and after it (tail); the selection itself is dropped. A caret inside the "• " marker is
// treated as sitting right after it, so a split never cuts the marker in half.
const splitCaretLine = (value: string, start: number, end: number) => {
  const lineStart = lineStartAt(value, start);
  const lineEnd = lineEndAt(value, end);
  let head = value.slice(lineStart, start);
  let tail = value.slice(end, lineEnd);
  const line = head + tail;

  if (line.startsWith(BULLET_MARKER) && head.length < BULLET_MARKER.length) {
    head = BULLET_MARKER;
    tail = line.slice(BULLET_MARKER.length);
  }

  return { lineStart, lineEnd, head, tail, line };
};

// Enter splits the line at the caret: the text before stays, the text after moves onto a
// new "• " bullet line (selection replaced, stray spaces at the split trimmed).
// - Enter on an empty bullet ("• ") does nothing, so empty bullets never pile up.
// - Enter on an empty plain line turns it into a bullet.
// - Enter at the start of a non-empty plain line pushes the line down unchanged.
export const applyEnter = (value: string, start: number, end: number): EditResult => {
  const { lineStart, lineEnd, head, tail, line } = splitCaretLine(value, start, end);
  const before = value.slice(0, lineStart);
  const after = value.slice(lineEnd);

  if (isEmptyBullet(line)) {
    return { value: before + line + after, caret: lineStart + line.length };
  }

  if (line.trim() === "") {
    return { value: before + BULLET_MARKER + after, caret: lineStart + BULLET_MARKER.length };
  }

  if (head === "") {
    return { value: `${before}\n${line}${after}`, caret: lineStart + 1 };
  }

  const keptHead = head === BULLET_MARKER ? head : head.replace(/[ \t]+$/, "");
  const movedTail = tail.replace(/^[ \t]+/, "");
  const nextLine = `${keptHead}\n${BULLET_MARKER}`;
  return {
    value: before + nextLine + movedTail + after,
    caret: lineStart + nextLine.length
  };
};

// Backspace with the caret on a bullet marker:
// - on an empty bullet, removes the whole line (caret to the end of the previous line);
// - otherwise strips "• " (the line becomes plain; the next press merges as usual).
// Anything else returns null so the browser deletes a character / merges lines.
export const applyBackspace = (value: string, start: number, end: number): EditResult | null => {
  if (start !== end) {
    return null;
  }

  const lineStart = lineStartAt(value, start);
  const lineEnd = lineEndAt(value, start);
  const lineText = value.slice(lineStart, lineEnd);
  const caretCol = start - lineStart;

  if (!lineText.startsWith(BULLET_MARKER) || caretCol > BULLET_MARKER.length) {
    return null;
  }

  if (isEmptyBullet(lineText)) {
    if (lineStart === 0) {
      const rest = value.slice(lineEnd + (lineEnd < value.length ? 1 : 0));
      return { value: rest, caret: 0 };
    }
    return { value: value.slice(0, lineStart - 1) + value.slice(lineEnd), caret: lineStart - 1 };
  }

  const stripped = lineText.slice(BULLET_MARKER.length);
  return {
    value: value.slice(0, lineStart) + stripped + value.slice(lineEnd),
    caret: lineStart + Math.max(0, caretCol - BULLET_MARKER.length)
  };
};

// Paste:
// - a single plain line (no line break) pastes inline as usual (null; an empty field still
//   gets its first bullet from applyAutoPrefix);
// - a single line wrapped in line breaks is pasted inline without the breaks;
// - several lines (or a bullet line) become "• " bullets on their own lines. Pasting on an
//   empty bullet fills it instead of leaving it empty, and text after the caret moves onto
//   its own bullet below the pasted ones. CRLF / CR line endings are handled.
export const applyPaste = (
  value: string,
  start: number,
  end: number,
  clipboard: string
): EditResult | null => {
  const text = clipboard.replace(/\r\n?/g, "\n");
  const lines = text.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return null;
  }

  if (lines.length === 1 && !isBulletLine(lines[0])) {
    if (!text.includes("\n")) {
      return null;
    }
    const emptyField = value.slice(0, start) === "" && value.slice(end) === "";
    const inserted = emptyField ? BULLET_MARKER + lines[0].trim() : lines[0];
    return {
      value: value.slice(0, start) + inserted + value.slice(end),
      caret: start + inserted.length
    };
  }

  const normalized = normalizeToBullets(text);
  const { lineStart, lineEnd, head, tail } = splitCaretLine(value, start, end);
  const startsOwnLine = head.trim() === "" || head === BULLET_MARKER;
  const before = startsOwnLine
    ? value.slice(0, lineStart)
    : `${value.slice(0, lineStart)}${head.replace(/[ \t]+$/, "")}\n`;
  const movedTail = tail.trim()
    ? `\n${isBulletLine(tail) ? tail.trimStart() : BULLET_MARKER + tail.trimStart()}`
    : "";
  const inserted = before + normalized;

  return {
    value: inserted + movedTail + value.slice(lineEnd),
    caret: inserted.length
  };
};

// When the user types the first character into an empty field, seed a "• " so the whole
// field reads as a bullet list. Returns null when no seeding is needed.
export const applyAutoPrefix = (
  previousValue: string,
  nextValue: string,
  caret: number
): EditResult | null => {
  if (previousValue !== "" || nextValue.trim() === "") {
    return null;
  }

  if (nextValue.startsWith(BULLET_MARKER) || nextValue.startsWith("\n") || isBulletLine(nextValue)) {
    return null;
  }

  return {
    value: BULLET_MARKER + nextValue,
    caret: caret + BULLET_MARKER.length
  };
};

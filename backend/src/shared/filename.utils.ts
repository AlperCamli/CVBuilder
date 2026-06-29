const encodedBytePattern = /%[0-9A-Fa-f]{2}/;

export const decodeFilenameText = (value: string): string => {
  if (!encodedBytePattern.test(value)) {
    return value;
  }

  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export const stripKnownExportExtension = (value: string): string =>
  decodeFilenameText(value).replace(/\.(pdf|docx)$/i, "");

export const sanitizeFilenameSegment = (
  value: string,
  fallback = "document",
  maxLength = 80
): string => {
  const cleaned = decodeFilenameText(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/g, "");

  if (!cleaned) {
    return fallback;
  }

  return cleaned.slice(0, maxLength);
};

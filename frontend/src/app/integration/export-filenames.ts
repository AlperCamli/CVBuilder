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
  options: { fallback?: string; separator?: "space" | "hyphen" } = {}
): string => {
  const separator = options.separator ?? "space";
  const whitespaceReplacement = separator === "hyphen" ? "-" : " ";
  const cleaned = decodeFilenameText(value)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[<>:"/\\|?*]+/g, " ")
    .trim()
    .replace(/\s+/g, whitespaceReplacement)
    .replace(/\.+$/g, "");

  return cleaned || options.fallback || "document";
};

export const buildCvExportFilename = (title: string, format: "pdf" | "docx"): string => {
  const safeTitle = sanitizeFilenameSegment(stripKnownExportExtension(title), { fallback: "cv" });
  return `${safeTitle}.${format}`;
};

export const extractNameSurname = (value: string): { name: string; surname: string } => {
  const normalized = stripKnownExportExtension(value)
    .replace(/[_-]+/g, " ")
    .trim();

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const name = sanitizeFilenameSegment(tokens[0] ?? "Name", {
    fallback: "Name",
    separator: "hyphen"
  });
  const surname = sanitizeFilenameSegment(tokens[1] ?? "Surname", {
    fallback: "Surname",
    separator: "hyphen"
  });

  return { name, surname };
};

export const buildTailoredExportFilename = (
  masterTitle: string | null | undefined,
  tailoredTitle: string,
  companyName: string | null | undefined,
  format: "pdf" | "docx" = "pdf"
): string => {
  const sourceTitle = masterTitle?.trim() ? masterTitle : tailoredTitle;
  const { name, surname } = extractNameSurname(sourceTitle);
  const company = sanitizeFilenameSegment(companyName ?? "", {
    fallback: "",
    separator: "hyphen"
  });

  return company.length > 0
    ? `001-${name}-${surname}-${company}.${format}`
    : `001-${name}-${surname}.${format}`;
};

interface CoverLetterFilenameJob {
  company_name?: string | null;
  job_title?: string | null;
}

const isUsefulCoverLetterTitle = (value: string): boolean => {
  const normalized = stripKnownExportExtension(value).replace(/cover letter\s*-\s*$/i, "").trim();
  return normalized.length > 0;
};

export const buildCoverLetterExportFilename = (
  title: string | null | undefined,
  job: CoverLetterFilenameJob | null | undefined,
  format: "pdf" | "docx"
): string => {
  const companyName = job?.company_name?.trim() ?? "";
  const jobTitle = job?.job_title?.trim() ?? "";
  const fallbackTitle = companyName
    ? `Cover Letter - ${companyName}`
    : jobTitle
      ? `Cover Letter - ${jobTitle}`
      : "cover-letter";
  const baseTitle = title && isUsefulCoverLetterTitle(title) ? title : fallbackTitle;
  const safeTitle = sanitizeFilenameSegment(stripKnownExportExtension(baseTitle), {
    fallback: "cover-letter"
  });

  return `${safeTitle}.${format}`;
};

export const triggerBlobDownload = async (url: string, filename: string): Promise<void> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download export file (${response.status}).`);
  }

  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(objectUrl);
};

import { useState } from "react";
import { Check, ChevronDown, ChevronUp, History as HistoryIcon, Pencil, RefreshCw, RotateCcw, Sparkles, X } from "lucide-react";
import { translate as t } from "../../localization/i18n";
import type { CvContent } from "../../integration/api-types";
import type {
  TailoringRefinement,
  TailoringRequirement,
  TailoringSuggestion
} from "../../integration/tailoring-types";
import { describeBlock, sectionTitle } from "./tailoring-labels";

const REFINEMENTS: Array<{ id: TailoringRefinement; label: string }> = [
  { id: "shorter", label: "Shorter" },
  { id: "more_impact", label: "More impact" },
  { id: "more_keywords", label: "More job terms" }
];

const bulletLines = (value: unknown): string[] =>
  String(value ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/^[\s•*·-]+/, "").trim())
    .filter(Boolean);

const asList = (value: unknown): string[] => (Array.isArray(value) ? value.map((item) => String(item)) : []);

export function SuggestionCard({
  suggestion,
  content,
  requirements,
  stale,
  undoBlocked,
  refining,
  onAccept,
  onReject,
  onUndo,
  onRefine,
  onRegenerate,
  onOpenEditor,
  onHover
}: {
  suggestion: TailoringSuggestion;
  content: CvContent;
  requirements: TailoringRequirement[];
  // Pending, but the user edited this part after it was generated.
  stale: boolean;
  // Applied, but the user edited this part afterwards, so it can't be undone here.
  undoBlocked: boolean;
  refining: boolean;
  onAccept: (editedValue?: string | string[]) => void;
  onReject: () => void;
  onUndo: () => void;
  onRefine: (refinement: TailoringRefinement) => void;
  // Null when the card has no task to re-run.
  onRegenerate: (() => void) | null;
  onOpenEditor: () => void;
  onHover: (active: boolean) => void;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const editable = suggestion.kind === "rewrite" || suggestion.kind === "skills";
  const isBulletField = suggestion.kind === "rewrite" && suggestion.suggested.field === "description";

  const title = (() => {
    switch (suggestion.kind) {
      case "rewrite":
        return suggestion.suggested.field === "text" ? t("Professional summary") : describeBlock(content, suggestion.block_id);
      case "skills":
        return t("Skills");
      case "new_section": {
        const section = suggestion.suggested.section as { type?: string } | undefined;
        return section?.type === "skills" ? t("New skills section") : t("New professional summary");
      }
      case "reorder":
        return t("Section order");
      case "hide_section":
        return t("Hide a section");
      default:
        return "";
    }
  })();

  const startEditing = () => {
    const value = suggestion.suggested.value;
    setDraft(suggestion.kind === "skills" ? asList(value).join(", ") : isBulletField ? bulletLines(value).join("\n") : String(value ?? ""));
    setEditing(true);
  };

  const submitEdit = () => {
    if (suggestion.kind === "skills") {
      const skills = draft.split(",").map((item) => item.trim()).filter(Boolean);
      if (skills.length > 0) onAccept(skills);
    } else {
      const text = isBulletField
        ? draft.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => `• ${line.replace(/^[•*·-]\s*/, "")}`).join("\n")
        : draft.trim();
      if (text) onAccept(text);
    }
    setEditing(false);
  };

  const requirementTags = suggestion.requirement_ids
    .map((id) => requirements.find((requirement) => requirement.id === id)?.text)
    .filter((text): text is string => Boolean(text))
    .slice(0, 3);

  const statusTone =
    suggestion.status === "applied"
      ? { border: "var(--color-teal-200)", background: "var(--color-teal-50)" }
      : suggestion.status === "rejected"
        ? { border: "var(--color-border-tertiary)", background: "var(--color-background-secondary)" }
        : { border: "var(--color-border-secondary)", background: "var(--color-background-primary)" };

  const renderBody = () => {
    if (editing) {
      return (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={suggestion.kind === "skills" ? 3 : 6}
            className="w-full px-3 py-2 rounded-lg border resize-y"
            style={{ fontSize: "13px", lineHeight: 1.5, borderColor: "var(--color-border-secondary)" }}
            aria-label={t("Edit suggestion")}
          />
          <p style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
            {suggestion.kind === "skills" ? t("Separate skills with commas.") : isBulletField ? t("One bullet point per line.") : null}
          </p>
        </div>
      );
    }

    if (suggestion.kind === "rewrite") {
      const after = suggestion.suggested.value;
      const before = suggestion.before?.value;
      return (
        <div className="space-y-2">
          {isBulletField ? (
            <ul className="space-y-1" style={{ fontSize: "13px", lineHeight: 1.5 }}>
              {bulletLines(after).map((line, index) => (
                <li key={index} className="flex gap-2">
                  <span style={{ color: "var(--color-teal-600)" }}>•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ fontSize: "13px", lineHeight: 1.55 }}>{String(after ?? "")}</p>
          )}
          {before ? (
            <button
              type="button"
              onClick={() => setShowOriginal((value) => !value)}
              className="inline-flex items-center gap-1"
              style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}
            >
              {showOriginal ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showOriginal ? t("Hide original") : t("Show original")}
            </button>
          ) : null}
          {showOriginal && before ? (
            <div className="rounded-md p-2" style={{ background: "var(--color-background-secondary)", fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
              {isBulletField ? bulletLines(before).map((line, index) => <p key={index}>• {line}</p>) : String(before)}
            </div>
          ) : null}
        </div>
      );
    }

    if (suggestion.kind === "skills" || (suggestion.kind === "new_section" && (suggestion.suggested.section as { type?: string })?.type === "skills")) {
      const after =
        suggestion.kind === "skills"
          ? asList(suggestion.suggested.value)
          : asList((suggestion.suggested.section as { blocks?: Array<{ fields?: { skills?: unknown } }> })?.blocks?.[0]?.fields?.skills);
      const before = asList(suggestion.before?.value);
      const beforeKeys = new Set(before.map((item) => item.toLowerCase()));
      const afterKeys = new Set(after.map((item) => item.toLowerCase()));
      return (
        <div className="flex flex-wrap gap-1.5">
          {after.map((skill) => (
            <span
              key={skill}
              className="px-2 py-0.5 rounded-full"
              style={{
                fontSize: "12px",
                background: beforeKeys.has(skill.toLowerCase()) ? "var(--color-background-secondary)" : "var(--color-teal-50)",
                color: beforeKeys.has(skill.toLowerCase()) ? "var(--color-text-primary)" : "var(--color-teal-800)",
                border: beforeKeys.has(skill.toLowerCase()) ? "1px solid transparent" : "1px solid var(--color-teal-200)"
              }}
            >
              {beforeKeys.has(skill.toLowerCase()) ? skill : `+ ${skill}`}
            </span>
          ))}
          {before
            .filter((skill) => !afterKeys.has(skill.toLowerCase()))
            .map((skill) => (
              <span key={`removed-${skill}`} className="px-2 py-0.5 rounded-full" style={{ fontSize: "12px", textDecoration: "line-through", color: "var(--color-text-secondary)" }}>
                {skill}
              </span>
            ))}
        </div>
      );
    }

    if (suggestion.kind === "new_section") {
      const text = (suggestion.suggested.section as { blocks?: Array<{ fields?: { text?: unknown } }> })?.blocks?.[0]?.fields?.text;
      return <p style={{ fontSize: "13px", lineHeight: 1.55 }}>{String(text ?? "")}</p>;
    }

    if (suggestion.kind === "reorder") {
      const order = asList(suggestion.suggested.section_order);
      return (
        <ol className="space-y-0.5" style={{ fontSize: "13px" }}>
          {order.map((sectionId, index) => (
            <li key={sectionId}>
              <span style={{ color: "var(--color-text-secondary)" }}>{index + 1}.</span> {sectionTitle(content, sectionId)}
            </li>
          ))}
        </ol>
      );
    }

    if (suggestion.kind === "hide_section") {
      return (
        <div style={{ fontSize: "13px" }}>
          <p>
            {t("Hide section")}: <strong>{String(suggestion.suggested.title ?? sectionTitle(content, String(suggestion.suggested.section_id ?? "")))}</strong>
          </p>
          <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
            {t("Only for this application. You can show it again any time.")}
          </p>
        </div>
      );
    }
    return null;
  };

  return (
    <div
      className="rounded-xl border p-3.5 space-y-2.5 transition-shadow hover:shadow-sm"
      style={{ borderColor: statusTone.border, background: statusTone.background, opacity: suggestion.status === "rejected" ? 0.75 : 1 }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate" style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-text-primary)" }}>{title}</p>
          {suggestion.add_to_main ? (
            <p style={{ fontSize: "11px", color: "var(--color-teal-700)" }}>{t("Also updates your main CV when accepted")}</p>
          ) : null}
        </div>
        {suggestion.status === "applied" ? (
          <span className="inline-flex items-center gap-1 shrink-0" style={{ fontSize: "11px", color: "var(--color-teal-700)", fontWeight: 500 }}>
            <Check size={12} /> {t("Applied")}
          </span>
        ) : suggestion.status === "rejected" ? (
          <span className="shrink-0" style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{t("Dismissed")}</span>
        ) : null}
      </div>

      {stale && suggestion.status === "pending" ? (
        <div className="rounded-md p-2 space-y-1.5" style={{ background: "var(--color-amber-50)", fontSize: "12px", color: "var(--color-amber-700)" }}>
          <p>{t("You edited this part after the suggestion was made.")}</p>
          <div className="flex items-center gap-3">
            {onRegenerate ? (
              <button type="button" onClick={onRegenerate} disabled={refining} className="inline-flex items-center gap-1 font-medium disabled:opacity-50">
                <RefreshCw size={12} /> {t("Regenerate")}
              </button>
            ) : null}
            <button type="button" onClick={onReject} disabled={refining} className="inline-flex items-center gap-1 disabled:opacity-50">
              <X size={12} /> {t("Dismiss")}
            </button>
          </div>
        </div>
      ) : null}

      <div style={{ opacity: refining ? 0.5 : 1 }}>{renderBody()}</div>

      {suggestion.rationale ? (
        <p className="flex items-start gap-1.5" style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.45 }}>
          <Sparkles size={12} style={{ marginTop: 2, flexShrink: 0, color: "var(--color-teal-600)" }} />
          <span>{suggestion.rationale}</span>
        </p>
      ) : null}

      {requirementTags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {requirementTags.map((text) => (
            <span key={text} className="px-1.5 py-0.5 rounded" style={{ fontSize: "10px", background: "var(--color-background-secondary)", color: "var(--color-text-secondary)" }}>
              {text}
            </span>
          ))}
        </div>
      ) : null}

      {suggestion.guard_notes.length > 0 ? (
        <p style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{suggestion.guard_notes[0]}</p>
      ) : null}

      {suggestion.status === "pending" && !stale ? (
        <div className="space-y-2 pt-0.5">
          <div className="flex items-center gap-1.5">
            {editing ? (
              <>
                <button type="button" onClick={submitEdit} className="px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1" style={{ fontSize: "12px", background: "var(--color-teal-600)", color: "white" }}>
                  <Check size={12} /> {t("Accept edited")}
                </button>
                <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 rounded-lg" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  {t("Cancel")}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => onAccept()} disabled={refining} className="px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1" style={{ fontSize: "12px", background: "var(--color-teal-600)", color: "white" }}>
                  <Check size={12} /> {t("Accept")}
                </button>
                {editable ? (
                  <button type="button" onClick={startEditing} disabled={refining} title={t("Edit before accepting")} aria-label={t("Edit before accepting")} className="p-1.5 rounded-lg border" style={{ borderColor: "var(--color-border-secondary)", color: "var(--color-text-secondary)" }}>
                    <Pencil size={13} />
                  </button>
                ) : null}
                <button type="button" onClick={onReject} disabled={refining} title={t("Dismiss")} aria-label={t("Dismiss")} className="p-1.5 rounded-lg border" style={{ borderColor: "var(--color-border-secondary)", color: "var(--color-text-secondary)" }}>
                  <X size={13} />
                </button>
              </>
            )}
          </div>
          {suggestion.kind === "rewrite" && suggestion.task_id && !editing ? (
            <div className="flex flex-wrap gap-1">
              {REFINEMENTS.map((refinement) => (
                <button
                  key={refinement.id}
                  type="button"
                  disabled={refining}
                  onClick={() => onRefine(refinement.id)}
                  className="px-2 py-0.5 rounded-full border"
                  style={{ fontSize: "11px", borderColor: "var(--color-border-tertiary)", color: "var(--color-text-secondary)" }}
                >
                  {t(refinement.label)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {suggestion.status !== "pending" && undoBlocked ? (
        <div className="space-y-1" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
          <p>{t("You edited this part after applying it, so it can't be undone here. Restore an earlier version from block history in the editor.")}</p>
          <button type="button" onClick={onOpenEditor} className="inline-flex items-center gap-1 font-medium" style={{ color: "var(--color-teal-700)" }}>
            <HistoryIcon size={12} /> {t("Back to editor")}
          </button>
        </div>
      ) : suggestion.status !== "pending" ? (
        <button type="button" onClick={onUndo} className="inline-flex items-center gap-1" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
          <RotateCcw size={12} /> {suggestion.status === "applied" ? t("Undo") : t("Restore")}
        </button>
      ) : null}
    </div>
  );
}

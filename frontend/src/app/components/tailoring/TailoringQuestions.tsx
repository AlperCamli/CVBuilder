import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import { translate as t } from "../../localization/i18n";
import type { CvContent } from "../../integration/api-types";
import {
  TAILORING_ANSWER_ENTRIES_MAX,
  TAILORING_ANSWER_ENTRY_DETAIL_MAX_LENGTH,
  type TailoringAnswer,
  type TailoringAnswerPayload,
  type TailoringQuestion
} from "../../integration/tailoring-types";
import {
  buildOpenMetricEntries,
  editableItemBlockIds,
  isSkippedAnswer,
  openMetricBlockOptions,
  sameAnswerEntries,
  type OpenMetricDraft
} from "./open-metric";
import { describeBlock, listRefinableBlocks } from "./tailoring-labels";

// Question cards of the Tailor panel: yes / some / no gap questions, specific number
// questions (optional, approximate is fine) and the open number question.

export type AnswerHandler = (payload: TailoringAnswerPayload) => Promise<boolean> | void;

const inputStyle = { fontSize: "13px", borderColor: "var(--color-border-secondary)", background: "var(--color-background-primary)" };

function SkippedRow({ text, onReopen, reopenLabel }: { text: string; onReopen: () => void; reopenLabel: string }) {
  return (
    <div className="tailor-question tailor-question-skipped">
      <p className="min-w-0 flex-1 truncate" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }} title={text}>
        {text}
      </p>
      <span className="tailor-question-chip">{t("Skipped")}</span>
      <button type="button" onClick={onReopen} className="tailor-link shrink-0">
        {reopenLabel}
      </button>
    </div>
  );
}

function AddToMainToggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

// Gap (yes / some / no) and specific number questions.
export function QuestionCard({
  question,
  content,
  answer,
  onAnswer
}: {
  question: TailoringQuestion;
  content: CvContent;
  answer: TailoringAnswer | undefined;
  onAnswer: AnswerHandler;
}) {
  const [detail, setDetail] = useState(answer?.detail ?? "");
  const [addToMain, setAddToMain] = useState(answer?.add_to_main ?? false);
  const [reopened, setReopened] = useState(false);
  const choice = answer?.answer ?? null;
  const target = question.target_block_id ? describeBlock(content, question.target_block_id) : null;
  const metric = question.kind === "metric";
  const savedDetail = answer?.detail?.trim() ?? "";

  // Keep the field in step with what the server saved (e.g. a failed save was rolled back).
  useEffect(() => setDetail(answer?.detail ?? ""), [answer?.detail]);
  useEffect(() => setAddToMain(answer?.add_to_main ?? false), [answer?.add_to_main]);

  if (metric && isSkippedAnswer(question, answer) && !reopened) {
    return <SkippedRow text={question.text} reopenLabel={t("Add a number")} onReopen={() => setReopened(true)} />;
  }

  const needsDetail = metric || choice === "yes" || choice === "some";
  const saveMetric = () => {
    const next = detail.trim();
    if (next && next !== savedDetail) onAnswer({ answer: null, detail: next, add_to_main: addToMain });
  };
  const skipMetric = () => {
    setDetail("");
    setReopened(false);
    onAnswer({ answer: null, detail: null, add_to_main: false });
  };

  return (
    <div className="tailor-question" data-answered={answer && !isSkippedAnswer(question, answer) ? "true" : undefined}>
      <div>
        <p style={{ fontSize: "13px", fontWeight: 500, lineHeight: 1.45 }}>{question.text}</p>
        {target ? <p style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{t("For")}: {target}</p> : null}
      </div>
      {question.kind === "gap" ? (
        <div className="flex gap-1.5" role="group" aria-label={question.text}>
          {(["yes", "some", "no"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={choice === value}
              onClick={() => onAnswer({ answer: value, detail: value === "no" ? null : detail.trim() || null, add_to_main: addToMain })}
              className="tailor-choice"
            >
              {value === "yes" ? t("Yes") : value === "some" ? t("Some") : t("No")}
            </button>
          ))}
        </div>
      ) : null}
      {needsDetail ? (
        <div className="space-y-2">
          <input
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            onBlur={() => {
              if (metric) saveMetric();
              else if (choice && detail.trim() !== savedDetail) {
                onAnswer({ answer: choice, detail: detail.trim() || null, add_to_main: addToMain });
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            maxLength={1000}
            placeholder={metric ? t("e.g. about 40 a week — skip if unsure") : t("Where and how? One short line (optional)")}
            aria-label={question.text}
            className="w-full px-3 py-2 rounded-lg border"
            style={inputStyle}
          />
          {metric ? (
            <div className="flex items-center justify-between gap-3">
              <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.4 }}>
                {t("Approximate is fine. Only numbers you give us are used.")}
              </p>
              <button
                type="button"
                // Keep the field from saving its text on blur first.
                onMouseDown={(event) => event.preventDefault()}
                onClick={skipMetric}
                className="tailor-link shrink-0"
              >
                {savedDetail ? t("Remove") : t("Skip")}
              </button>
            </div>
          ) : null}
          {question.target_block_id && (!metric || savedDetail) ? (
            <AddToMainToggle
              checked={addToMain}
              label={t("Also add this to my main CV")}
              onChange={(checked) => {
                setAddToMain(checked);
                if (answer) onAnswer({ answer: answer.answer, detail: detail.trim() || null, add_to_main: checked });
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const fromSaved = (answer: TailoringAnswer | undefined, nextKey: () => string): OpenMetricDraft[] =>
  (answer?.entries ?? []).map((entry) => ({ key: nextKey(), target_block_id: entry.target_block_id, detail: entry.detail }));

const PROBLEM_TEXT = {
  missing_block: "Choose the entry this number belongs to.",
  unknown_block: "Choose the entry this number belongs to.",
  too_long: "Keep it under 300 characters."
} as const;

// The open number question: up to five figures, each for one experience / project /
// volunteering item. Saving re-runs the rewrites of the items whose figures changed.
export function OpenMetricQuestion({
  content,
  answer,
  updating,
  onAnswer
}: {
  content: CvContent;
  answer: TailoringAnswer | undefined;
  // A rewrite is being updated with these figures.
  updating: boolean;
  onAnswer: (payload: TailoringAnswerPayload) => Promise<boolean>;
}) {
  const keyCounter = useRef(0);
  const nextKey = () => `entry-${(keyCounter.current += 1)}`;
  const [drafts, setDrafts] = useState<OpenMetricDraft[]>(() => fromSaved(answer, nextKey));
  const [addToMain, setAddToMain] = useState(answer?.add_to_main ?? false);
  const [saving, setSaving] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  // Local edits win over a newer saved answer until they are saved or the save failed.
  const touched = useRef(false);

  const savedSignature = JSON.stringify([answer?.entries ?? null, answer?.add_to_main ?? false]);
  useEffect(() => {
    if (touched.current) return;
    setDrafts(fromSaved(answer, nextKey));
    setAddToMain(answer?.add_to_main ?? false);
  }, [savedSignature]);

  const options = useMemo(() => openMetricBlockOptions(content), [content]);
  const allowedIds = useMemo(() => editableItemBlockIds(content), [content]);
  // A saved figure for another editable item (e.g. education) stays selectable.
  const selectable = useMemo(() => {
    const listed = new Set(options.map((option) => option.blockId));
    const extra = listRefinableBlocks(content).filter(
      (block) => block.kind === "item" && !listed.has(block.blockId) && drafts.some((draft) => draft.target_block_id === block.blockId)
    );
    return [...options, ...extra];
  }, [content, drafts, options]);
  const sections = [...new Set(selectable.map((option) => option.sectionTitle))];

  const { entries, problems } = buildOpenMetricEntries(drafts, allowedIds);
  const savedEntries = answer?.entries ?? [];
  const hasProblems = Object.keys(problems).length > 0;
  const dirty =
    !sameAnswerEntries(entries, savedEntries) || (entries.length > 0 && addToMain !== (answer?.add_to_main ?? false));
  const canSave = dirty && !hasProblems && !saving && (entries.length > 0 || savedEntries.length > 0);
  const skipped = answer !== undefined && savedEntries.length === 0;
  const typed = drafts.some((draft) => draft.detail.trim());

  const edit = (next: OpenMetricDraft[]) => {
    touched.current = true;
    setDrafts(next);
  };
  const addRow = () => {
    const used = new Set(drafts.map((draft) => draft.target_block_id));
    const target = options.find((option) => !used.has(option.blockId)) ?? options[0];
    edit([...drafts, { key: nextKey(), target_block_id: target?.blockId ?? "", detail: "" }]);
  };
  const save = async (payloadEntries = entries) => {
    if (hasProblems && payloadEntries === entries) {
      setShowProblems(true);
      return;
    }
    setSaving(true);
    const saved = await onAnswer({ answer: null, detail: null, entries: payloadEntries, add_to_main: payloadEntries.length > 0 && addToMain });
    setSaving(false);
    if (saved) {
      touched.current = false;
      setShowProblems(false);
      setDrafts((current) => current.filter((draft) => draft.detail.trim()));
    }
  };
  const skip = () => {
    touched.current = false;
    setDrafts([]);
    void save([]);
  };

  if (options.length === 0 && drafts.length === 0) return null;

  return (
    <div className="tailor-question" data-answered={savedEntries.length > 0 ? "true" : undefined}>
      <div>
        <p style={{ fontSize: "13px", fontWeight: 500, lineHeight: 1.45 }}>{t("Is there any number you'd like to add to your experience?")}</p>
        <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.4 }}>
          {t("Team size, clients, budget, time saved… approximate is fine. Skip if not.")}
        </p>
      </div>

      {drafts.length > 0 ? (
        <ul className="space-y-2">
          {drafts.map((draft, index) => {
            const problem = showProblems || (draft.detail.trim() && !draft.target_block_id) ? problems[draft.key] : undefined;
            return (
              <li key={draft.key} className="tailor-entry">
                <div className="flex items-center gap-1.5">
                  <select
                    value={draft.target_block_id}
                    onChange={(event) =>
                      edit(drafts.map((item) => (item.key === draft.key ? { ...item, target_block_id: event.target.value } : item)))
                    }
                    aria-label={t("CV entry for number {{count}}", { count: index + 1 })}
                    className="tailor-entry-select"
                  >
                    {!draft.target_block_id || !selectable.some((option) => option.blockId === draft.target_block_id) ? (
                      <option value="">{t("Choose an entry…")}</option>
                    ) : null}
                    {sections.length > 1
                      ? sections.map((title) => (
                          <optgroup key={title} label={title}>
                            {selectable
                              .filter((option) => option.sectionTitle === title)
                              .map((option) => (
                                <option key={option.blockId} value={option.blockId}>
                                  {[option.title, option.subtitle].filter(Boolean).join(" · ")}
                                </option>
                              ))}
                          </optgroup>
                        ))
                      : selectable.map((option) => (
                          <option key={option.blockId} value={option.blockId}>
                            {[option.title, option.subtitle].filter(Boolean).join(" · ")}
                          </option>
                        ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => edit(drafts.filter((item) => item.key !== draft.key))}
                    aria-label={t("Remove this number")}
                    title={t("Remove this number")}
                    className="tailor-entry-remove"
                  >
                    <X size={13} />
                  </button>
                </div>
                <input
                  value={draft.detail}
                  onChange={(event) => edit(drafts.map((item) => (item.key === draft.key ? { ...item, detail: event.target.value } : item)))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && canSave) void save();
                  }}
                  maxLength={TAILORING_ANSWER_ENTRY_DETAIL_MAX_LENGTH}
                  placeholder={t("e.g. ~40 shipments a week")}
                  aria-label={t("Number {{count}} and what it measures", { count: index + 1 })}
                  className="w-full px-3 py-2 rounded-lg border"
                  style={inputStyle}
                  aria-invalid={problem ? true : undefined}
                />
                {problem ? (
                  <p role="alert" style={{ fontSize: "11px", color: "var(--color-red-700)" }}>{t(PROBLEM_TEXT[problem])}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {drafts.length < TAILORING_ANSWER_ENTRIES_MAX ? (
          <button type="button" onClick={addRow} className="tailor-link inline-flex items-center gap-1" style={{ color: "var(--color-teal-700)", fontWeight: 500 }}>
            <Plus size={12} /> {drafts.length === 0 ? t("Add a number") : t("Add another")}
          </button>
        ) : (
          <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{t("Up to 5 numbers.")}</span>
        )}
        {skipped && drafts.length === 0 ? <span className="tailor-question-chip">{t("Skipped")}</span> : null}
        {!answer && !typed ? (
          <button type="button" onClick={skip} className="tailor-link ml-auto">
            {t("Skip")}
          </button>
        ) : null}
      </div>

      {entries.length > 0 ? (
        <AddToMainToggle
          checked={addToMain}
          label={t("Also add these to my main CV")}
          onChange={(checked) => {
            touched.current = true;
            setAddToMain(checked);
          }}
        />
      ) : null}

      {dirty || saving ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={!canSave && !hasProblems}
            className="px-3 py-1.5 rounded-lg font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
            style={{ fontSize: "12px", background: "var(--color-teal-600)", color: "white" }}
          >
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            {entries.length === 0 && savedEntries.length > 0 ? t("Save without numbers") : t("Save numbers")}
          </button>
          {answer ? (
            <button
              type="button"
              onClick={() => {
                touched.current = false;
                setShowProblems(false);
                setDrafts(fromSaved(answer, nextKey));
                setAddToMain(answer.add_to_main);
              }}
              className="tailor-link"
            >
              {t("Cancel")}
            </button>
          ) : null}
        </div>
      ) : updating ? (
        <p className="flex items-center gap-1.5" style={{ fontSize: "11px", color: "var(--color-teal-800)" }}>
          <Loader2 size={11} className="animate-spin" /> {t("Updating with your answer…")}
        </p>
      ) : savedEntries.length > 0 ? (
        <p className="flex items-center gap-1.5" style={{ fontSize: "11px", color: "var(--color-teal-800)" }}>
          <Check size={11} /> {t("Saved. Suggestions for these entries include them.")}
        </p>
      ) : null}
    </div>
  );
}

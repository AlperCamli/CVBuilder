import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowUp, ChevronDown, ChevronUp, Info, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { translate as t } from "../../localization/i18n";
import type { CvContent } from "../../integration/api-types";
import {
  TAILORING_INSTRUCTION_MAX_LENGTH,
  type TailoringRefinePayload,
  type TailoringRefinement,
  type TailoringSessionView,
  type TailoringSuggestion
} from "../../integration/tailoring-types";
import { AiStatusLine, AiWorkingBadge, ShimmerBlock } from "./ai-elements";
import { listRefinableBlocks, type RefinableBlock } from "./tailoring-labels";
import type { TailoringRefineRun, TailoringSessionController } from "./useTailoringSession";

// Same quick edits as the editor's block AI bubble, as tailoring refinements.
export const REFINE_ACTIONS: Array<{ id: TailoringRefinement; label: string }> = [
  { id: "improve", label: "Improve" },
  { id: "shorter", label: "Shorter" },
  { id: "more_professional", label: "More professional" },
  { id: "more_keywords", label: "More job terms" },
  { id: "more_impact", label: "More impact" }
];

// Cards shown next to a block: its pending cards and the ones refine runs made in this tab
// (kept after a decision so they can be undone here). Pending first, newest first.
export const refineSuggestionsForBlock = (
  suggestions: TailoringSuggestion[],
  blockId: string,
  run: TailoringRefineRun | undefined
): TailoringSuggestion[] => {
  const refined = new Set(run?.suggestionIds ?? []);
  return suggestions
    .filter((item) => item.block_id === blockId && item.status !== "expired" && (item.status === "pending" || refined.has(item.id)))
    .sort((left, right) => {
      if ((left.status === "pending") !== (right.status === "pending")) return left.status === "pending" ? -1 : 1;
      return right.created_at.localeCompare(left.created_at);
    });
};

function RefineBlockItem({
  block,
  open,
  focusToken,
  run,
  working,
  pendingCount,
  draft,
  onDraftChange,
  onToggle,
  onRun,
  onHover,
  children
}: {
  block: RefinableBlock;
  open: boolean;
  // Changes when the block is asked for again (e.g. from the preview) while already open.
  focusToken: number;
  run: TailoringRefineRun | undefined;
  // Another run on this block (a task, or an update after an answer), with its label.
  working: string | null;
  pendingCount: number;
  draft: string;
  onDraftChange: (value: string) => void;
  onToggle: () => void;
  onRun: (payload: TailoringRefinePayload) => void;
  onHover: (active: boolean) => void;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bodyId = useId();
  const inputId = useId();
  const hintId = useId();
  const refining = run?.status === "running";
  const busy = refining || Boolean(working);
  const canRun = draft.trim().length > 0 && !busy;

  // Opening a block (here or from the preview's "Refine with AI") brings it into view and
  // puts the cursor in its instruction box.
  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      containerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      inputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusToken, open]);

  const submit = () => {
    if (canRun) onRun({ instruction: draft.trim() });
  };

  return (
    <div
      ref={containerRef}
      className="tailor-refine-item"
      data-open={open}
      data-refine-block-id={block.blockId}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <button
        type="button"
        className="tailor-refine-row"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        onFocus={() => onHover(true)}
        onBlur={() => onHover(false)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate" style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-text-primary)" }}>{block.title}</span>
          {block.subtitle ? (
            <span className="block truncate" style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{block.subtitle}</span>
          ) : null}
        </span>
        {busy ? (
          <Loader2 size={13} className="animate-spin shrink-0" style={{ color: "var(--color-teal-600)" }} aria-label={t("AI is working on this part")} />
        ) : pendingCount > 0 ? (
          <span className="shrink-0 px-1.5 rounded-full" style={{ fontSize: "10px", lineHeight: "16px", background: "var(--color-teal-50)", color: "var(--color-teal-800)", border: "1px solid var(--color-teal-200)" }}>
            {pendingCount} {t("to review")}
          </span>
        ) : null}
        {open ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
      </button>

      {open ? (
        <div id={bodyId} className="px-3 pb-3 space-y-2.5" aria-busy={busy}>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Quick AI edits")}>
            {REFINE_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                className="tailor-refine-chip"
                disabled={busy}
                onClick={() => onRun({ refinement: action.id })}
              >
                {t(action.label)}
              </button>
            ))}
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label htmlFor={inputId} className="sr-only">{t("Tell the AI what to change…")}</label>
            <div className="relative">
              <textarea
                ref={inputRef}
                id={inputId}
                rows={2}
                maxLength={TAILORING_INSTRUCTION_MAX_LENGTH}
                value={draft}
                disabled={refining}
                aria-describedby={hintId}
                placeholder={t("Tell the AI what to change…")}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submit();
                  }
                }}
                className="w-full resize-none rounded-xl border p-2.5 pr-11 outline-none focus:ring-2 focus:ring-[var(--color-teal-100)] disabled:opacity-60"
                style={{ fontSize: "13px", lineHeight: 1.45, borderColor: "var(--color-border-secondary)", background: "var(--color-background-secondary)" }}
              />
              <button
                type="submit"
                disabled={!canRun}
                aria-label={t("Run")}
                title={t("Run")}
                className="absolute bottom-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-lg disabled:opacity-40"
                style={{ background: "var(--color-teal-600)", color: "white" }}
              >
                {refining ? <Loader2 size={14} className="animate-spin" /> : <ArrowUp size={14} />}
              </button>
            </div>
            <p id={hintId} className="mt-1 flex justify-between gap-2" style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
              <span>{t("Enter to run · Shift + Enter for a new line")}</span>
              {draft.length > TAILORING_INSTRUCTION_MAX_LENGTH - 100 ? (
                <span style={{ fontVariantNumeric: "tabular-nums" }}>{draft.length}/{TAILORING_INSTRUCTION_MAX_LENGTH}</span>
              ) : null}
            </p>
          </form>

          {refining ? (
            <div className="space-y-2" role="status">
              <AiWorkingBadge label={t("Refining this part…")} compact />
              <ShimmerBlock height={44} />
            </div>
          ) : working ? (
            <p role="status" className="flex items-center gap-1.5" style={{ fontSize: "12px", color: "var(--color-teal-800)" }}>
              <Loader2 size={12} className="animate-spin" /> {working}
            </p>
          ) : null}

          {run?.status === "failed" ? (
            <div role="alert" className="rounded-lg p-2.5 space-y-1.5" style={{ background: "var(--color-red-50)", color: "var(--color-red-700)", fontSize: "12px" }}>
              <p className="flex items-start gap-1.5">
                <AlertCircle size={13} className="shrink-0" style={{ marginTop: 2 }} /> {t(run.message ?? "Couldn't refine this part of your CV.")}
              </p>
              <button type="button" onClick={() => onRun(run.payload)} disabled={busy} className="inline-flex items-center gap-1 font-semibold disabled:opacity-50">
                <RefreshCw size={12} /> {t("Retry")}
              </button>
            </div>
          ) : run?.status === "empty" ? (
            <p className="flex items-start gap-1.5" style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>
              <Info size={13} className="shrink-0" style={{ marginTop: 2 }} /> {t("No changes suggested for this part. Try a different instruction.")}
            </p>
          ) : null}

          {children}
        </div>
      ) : null}
    </div>
  );
}

export function RefineArea({
  view,
  content,
  controller,
  runningTaskIds,
  renderSuggestion,
  onHighlight
}: {
  view: TailoringSessionView;
  content: CvContent;
  controller: TailoringSessionController;
  runningTaskIds: Set<string>;
  renderSuggestion: (suggestion: TailoringSuggestion) => ReactNode;
  onHighlight: (ids: string[] | null, tone?: "highlight" | "evidence") => void;
}) {
  const blocks = useMemo(() => listRefinableBlocks(content), [content]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const target = controller.refineTargetBlockId;
  const targetMissing = Boolean(target) && !blocks.some((block) => block.blockId === target);

  // Grouped by section, in CV order.
  const groups = useMemo(() => {
    const result: Array<{ sectionId: string; title: string; blocks: RefinableBlock[] }> = [];
    for (const block of blocks) {
      const last = result[result.length - 1];
      if (last && last.sectionId === block.sectionId) last.blocks.push(block);
      else result.push({ sectionId: block.sectionId, title: block.sectionTitle, blocks: [block] });
    }
    return result;
  }, [blocks]);

  // Clear the preview highlight when the area goes away.
  const highlight = useRef(onHighlight);
  highlight.current = onHighlight;
  useEffect(() => () => highlight.current(null), []);

  const updating = controller.answerRerunTaskIds.size;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="flex items-center gap-1.5" style={{ fontSize: "13px", fontWeight: 600 }}>
          <Sparkles size={13} style={{ color: "var(--color-teal-600)" }} /> {t("Refine with AI")}
        </h3>
        <p style={{ fontSize: "12px", color: "var(--color-text-secondary)", lineHeight: 1.45 }}>
          {t("Pick a part of your CV and tell the AI what to change. Every result is a suggestion you can review.")}
        </p>
      </div>

      {updating > 0 ? (
        <AiStatusLine label={t("Updating {{count}} suggestions with your answer…", { count: updating })} />
      ) : null}

      {targetMissing ? (
        <div className="rounded-lg p-2.5 flex items-start gap-2" style={{ background: "var(--color-amber-50)", color: "var(--color-amber-700)", fontSize: "12px" }}>
          <Info size={13} className="shrink-0" style={{ marginTop: 2 }} />
          <p className="flex-1">{t("This part of your CV can't be refined here. Pick one of the parts below.")}</p>
          <button type="button" onClick={controller.closeRefine} aria-label={t("Dismiss")} className="shrink-0 p-0.5 rounded">
            <X size={13} />
          </button>
        </div>
      ) : null}

      {blocks.length === 0 ? (
        <p style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>{t("Add a summary, experience or skills to your CV to refine them here.")}</p>
      ) : null}

      {groups.map((group) => (
        <div key={group.sectionId} className="space-y-1.5">
          <p style={{ fontSize: "11px", color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}>
            {group.title}
          </p>
          {group.blocks.map((block) => {
            const run = controller.refineRuns[block.blockId];
            const suggestions = refineSuggestionsForBlock(view.suggestions, block.blockId, run);
            const tasks = view.tasks.filter((task) => task.block_id === block.blockId);
            const rerun = tasks.some((task) => controller.answerRerunTaskIds.has(task.id));
            const running = tasks.some((task) => runningTaskIds.has(task.id));
            // A refused refine (409: already running) shows as progress while the task runs.
            const working =
              run?.status === "running"
                ? null
                : rerun
                  ? t("Updating with your answer…")
                  : run?.status === "busy" && (running || tasks.some((task) => task.status === "running" || task.status === "ready"))
                    ? t("Already updating this part…")
                    : running
                      ? t("AI is working on this part…")
                      : null;
            return (
              <RefineBlockItem
                key={block.blockId}
                block={block}
                open={target === block.blockId}
                focusToken={target === block.blockId ? controller.refineFocusToken : 0}
                run={run}
                working={working}
                pendingCount={suggestions.filter((item) => item.status === "pending").length}
                draft={drafts[block.blockId] ?? ""}
                onDraftChange={(value) => setDrafts((current) => ({ ...current, [block.blockId]: value }))}
                onToggle={() => (target === block.blockId ? controller.closeRefine() : controller.openRefine(block.blockId))}
                onRun={(payload) => {
                  void controller.refineBlock(block.blockId, payload).then((ok) => {
                    if (ok && payload.instruction) setDrafts((current) => ({ ...current, [block.blockId]: "" }));
                  });
                }}
                onHover={(active) => onHighlight(active ? [block.blockId] : null, "highlight")}
              >
                {suggestions.length > 0 ? <div className="space-y-2">{suggestions.map(renderSuggestion)}</div> : null}
              </RefineBlockItem>
            );
          })}
        </div>
      ))}
    </div>
  );
}

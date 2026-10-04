import { useId, useMemo, useRef } from "react";
import { ArrowUp, Loader2, Sparkles, X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "./ui/popover";
import type { BlockSuggestInput } from "../integration/backend-api";

type BlockAction = BlockSuggestInput["action_type"];

const QUICK_ACTIONS: { label: string; action: BlockAction; instruction?: string }[] = [
  { label: "Improve", action: "improve" },
  { label: "Summarize", action: "summarize" },
  { label: "Expand", action: "expand" },
  {
    label: "Make More Professional",
    action: "improve",
    instruction: "Make the writing more professional with clear, confident language. Preserve the existing facts and meaning."
  },
  {
    label: "Make More Concise",
    action: "summarize",
    instruction: "Make the writing more concise by removing repetition and unnecessary words. Retain the key details, achievements, and existing facts."
  }
];

interface AIBlockInstructionBubbleProps {
  anchor: HTMLElement;
  instruction: string;
  loading: boolean;
  error: string | null;
  onInstructionChange: (value: string) => void;
  onRun: (action: BlockAction, instruction?: string) => void;
  onClose: () => void;
}

export function AIBlockInstructionBubble({
  anchor, instruction, loading, error, onInstructionChange, onRun, onClose
}: AIBlockInstructionBubbleProps) {
  const inputId = useId();
  const titleId = useId();
  const hintId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const restoreFocusRef = useRef(true);
  const virtualRef = useMemo(() => ({ current: anchor }), [anchor]);
  const canSubmit = instruction.trim().length > 0 && !loading;

  return (
    <Popover open onOpenChange={(open) => { if (!open && !loading) onClose(); }}>
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={10}
        collisionPadding={16}
        className="w-[360px] max-w-[calc(100vw-32px)] rounded-2xl p-4 shadow-xl"
        style={{ background: "var(--color-background-primary)", borderColor: "var(--color-border-tertiary)", color: "var(--color-text-primary)" }}
        aria-labelledby={titleId}
        aria-busy={loading}
        onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (restoreFocusRef.current && anchor.isConnected) anchor.focus();
        }}
        onEscapeKeyDown={(event) => { if (loading) event.preventDefault(); }}
        onInteractOutside={(event) => {
          if (loading) event.preventDefault();
          else restoreFocusRef.current = false;
        }}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <p id={titleId} className="flex items-center gap-2 text-sm font-medium">
            <Sparkles size={15} style={{ color: "var(--color-accent-primary)" }} />
            Improve with AI
          </p>
          <button type="button" aria-label="Close AI editing" onClick={onClose} disabled={loading}
            className="rounded-md p-1 hover:bg-black/5 focus-visible:ring-2 disabled:opacity-50">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); if (canSubmit) onRun("improve", instruction.trim()); }}>
          <label htmlFor={inputId} className="sr-only">How should AI change this block?</label>
          <div className="relative">
            <textarea
              ref={inputRef}
              id={inputId}
              rows={3}
              maxLength={3000}
              value={instruction}
              disabled={loading}
              aria-describedby={hintId}
              placeholder="How should this block change? e.g. Focus on my leadership experience"
              onChange={(event) => onInstructionChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  if (canSubmit) onRun("improve", instruction.trim());
                }
              }}
              className="w-full resize-none rounded-xl border p-3 pr-12 text-sm outline-none focus:ring-2 focus:ring-violet-300 disabled:opacity-60"
              style={{ borderColor: "var(--color-border-tertiary)", background: "var(--color-background-secondary)" }}
            />
            <button type="submit" disabled={!canSubmit} aria-label="Apply AI instruction"
              className="absolute bottom-3 right-3 flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-white hover:bg-violet-700 focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40">
              {loading ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
            </button>
          </div>
          <p id={hintId} className="mt-1 text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
            Enter to apply · Shift + Enter for a new line
          </p>
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Quick AI edits">
          {QUICK_ACTIONS.map((item) => (
            <button key={item.label} type="button" disabled={loading}
              onClick={() => onRun(item.action, item.instruction)}
              className="rounded-full border px-2.5 py-1.5 text-xs transition-colors hover:bg-violet-50 hover:text-violet-700 focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50"
              style={{ borderColor: "var(--color-border-tertiary)" }}>
              {item.label}
            </button>
          ))}
        </div>
        {error ? <p role="alert" className="mt-3 text-xs text-red-600">{error}</p> : null}
        <p role="status" className="mt-3 text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
          {loading ? "Updating this block…" : "Changes apply to this block. Use its version arrows to undo."}
        </p>
      </PopoverContent>
    </Popover>
  );
}

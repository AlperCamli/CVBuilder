import { useCallback, useLayoutEffect, useRef, type ComponentProps } from "react";

import { applyAutoPrefix, applyBackspace, applyEnter, applyPaste } from "./bulletEditing";
import { BULLET_MARKER } from "../integration/bulletText";

type NativeTextareaProps = Omit<ComponentProps<"textarea">, "value" | "onChange">;

interface BulletTextareaProps extends NativeTextareaProps {
  value: string;
  onValueChange: (next: string) => void;
}

// A controlled textarea that behaves as a bullet list: Enter starts a new "• " bullet,
// Backspace strips the marker (or removes an empty bullet), multi-line paste becomes
// bullets, and the first keystroke into an empty field auto-seeds a bullet. Pure
// transforms live in bulletEditing.ts. Used for every narrative field (the shared rule is
// integration/narrative-fields.ts). The caret is restored after the controlled re-render
// via a layout effect so it never jumps to the end. IME composition is never interrupted.
export function BulletTextarea({
  value,
  onValueChange,
  onKeyDown,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
  ...rest
}: BulletTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const composingFromEmptyRef = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && pendingCaretRef.current != null) {
      const caret = pendingCaretRef.current;
      el.setSelectionRange(caret, caret);
      pendingCaretRef.current = null;
    }
  }, [value]);

  const commit = useCallback(
    (next: string, caret: number) => {
      if (next === value) {
        // No re-render will follow, so place the caret now instead of leaving a stale
        // pending caret that would jump on the next unrelated change.
        ref.current?.setSelectionRange(caret, caret);
        return;
      }
      pendingCaretRef.current = caret;
      onValueChange(next);
    },
    [value, onValueChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(e);
      if (e.defaultPrevented || e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }

      const el = e.currentTarget;
      const { selectionStart: start, selectionEnd: end } = el;

      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const result = applyEnter(value, start, end);
        commit(result.value, result.caret);
        return;
      }

      if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const result = applyBackspace(value, start, end);
        if (result) {
          e.preventDefault();
          commit(result.value, result.caret);
        }
      }
    },
    [value, commit, onKeyDown]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      onPaste?.(e);
      if (e.defaultPrevented) {
        return;
      }

      const clipboard = e.clipboardData.getData("text/plain");
      if (!clipboard) {
        return;
      }

      const el = e.currentTarget;
      const result = applyPaste(value, el.selectionStart, el.selectionEnd, clipboard);
      if (result) {
        e.preventDefault();
        commit(result.value, result.caret);
      }
    },
    [value, commit, onPaste]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = e.currentTarget.value;
      const composing = (e.nativeEvent as InputEvent).isComposing === true;
      const seeded = composing ? null : applyAutoPrefix(value, nextValue, e.currentTarget.selectionStart);
      if (seeded) {
        commit(seeded.value, seeded.caret);
        return;
      }
      onValueChange(nextValue);
    },
    [value, commit, onValueChange]
  );

  const handleCompositionStart = useCallback(
    (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      onCompositionStart?.(e);
      composingFromEmptyRef.current = e.currentTarget.value === "";
    },
    [onCompositionStart]
  );

  // A field that was empty when an IME composition started gets its first bullet once the
  // composition is committed (seeding mid-composition would cancel the composed text).
  const handleCompositionEnd = useCallback(
    (e: React.CompositionEvent<HTMLTextAreaElement>) => {
      onCompositionEnd?.(e);
      const el = e.currentTarget;
      const fromEmpty = composingFromEmptyRef.current;
      composingFromEmptyRef.current = false;
      if (!fromEmpty) {
        return;
      }
      const seeded = applyAutoPrefix("", el.value, el.selectionStart);
      if (seeded && !el.value.startsWith(BULLET_MARKER)) {
        pendingCaretRef.current = seeded.caret;
        onValueChange(seeded.value);
      }
    },
    [onCompositionEnd, onValueChange]
  );

  return (
    <textarea
      ref={ref}
      {...rest}
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onCompositionStart={handleCompositionStart}
      onCompositionEnd={handleCompositionEnd}
    />
  );
}

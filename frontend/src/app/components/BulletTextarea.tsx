import { useCallback, useLayoutEffect, useRef, type ComponentProps } from "react";

import { applyAutoPrefix, applyBackspace, applyEnter, applyPaste } from "./bulletEditing";

type NativeTextareaProps = Omit<ComponentProps<"textarea">, "value" | "onChange">;

interface BulletTextareaProps extends NativeTextareaProps {
  value: string;
  onValueChange: (next: string) => void;
}

// A controlled textarea that behaves as a bullet list: Enter starts a new "• " bullet,
// Backspace strips the marker (then merges on the next press), paste preserves bullets, and
// the first keystroke into an empty field auto-seeds a bullet. Pure transforms live in
// bulletEditing.ts. Caret is restored after the controlled re-render via a layout effect so
// it never jumps to the end.
export function BulletTextarea({ value, onValueChange, ...rest }: BulletTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

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
      pendingCaretRef.current = caret;
      onValueChange(next);
    },
    [onValueChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const el = e.currentTarget;
      const { selectionStart: start, selectionEnd: end } = el;

      if (e.key === "Enter" && !e.nativeEvent.isComposing) {
        e.preventDefault();
        const result = applyEnter(value, start, end);
        commit(result.value, result.caret);
        return;
      }

      if (e.key === "Backspace") {
        const result = applyBackspace(value, start, end);
        if (result) {
          e.preventDefault();
          commit(result.value, result.caret);
        }
      }
    },
    [value, commit]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
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
    [value, commit]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const nextValue = e.currentTarget.value;
      const seeded = applyAutoPrefix(value, nextValue, e.currentTarget.selectionStart);
      if (seeded) {
        commit(seeded.value, seeded.caret);
        return;
      }
      onValueChange(nextValue);
    },
    [value, commit, onValueChange]
  );

  return (
    <textarea
      ref={ref}
      {...rest}
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
    />
  );
}

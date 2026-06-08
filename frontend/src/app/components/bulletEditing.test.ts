import { describe, expect, it } from "vitest";
import { applyAutoPrefix, applyBackspace, applyEnter, applyPaste } from "./bulletEditing";

describe("bulletEditing", () => {
  it("Enter inserts a new bullet and places the caret after the marker", () => {
    const value = "• First";
    const caret = value.length;
    const result = applyEnter(value, caret, caret);
    expect(result.value).toBe("• First\n• ");
    expect(result.value.slice(result.caret)).toBe("");
    expect(result.value.slice(0, result.caret)).toBe("• First\n• ");
  });

  it("first Backspace strips the • marker, leaving the line plain", () => {
    const value = "• First\n• Second";
    const lineStart = value.indexOf("• Second");
    const caret = lineStart + "• ".length; // caret right after the marker
    const result = applyBackspace(value, caret, caret);
    expect(result).not.toBeNull();
    expect(result?.value).toBe("• First\nSecond");
  });

  it("second Backspace (plain line, column 0) defers to default merge", () => {
    const value = "• First\nSecond";
    const caret = value.indexOf("Second"); // column 0 of the now-plain line
    expect(applyBackspace(value, caret, caret)).toBeNull();
  });

  it("Backspace mid-word defers to default character delete", () => {
    const value = "• First";
    const caret = value.length;
    expect(applyBackspace(value, caret, caret)).toBeNull();
  });

  it("paste normalizes clipboard content into bullets on its own line", () => {
    const value = "• First";
    const caret = value.length;
    const result = applyPaste(value, caret, caret, "- Pasted A\n- Pasted B");
    expect(result?.value).toBe("• First\n• Pasted A\n• Pasted B");
  });

  it("auto-prefixes the first character typed into an empty field", () => {
    const result = applyAutoPrefix("", "H", 1);
    expect(result?.value).toBe("• H");
    expect(result?.caret).toBe(3);
  });

  it("does not auto-prefix when the field already had content", () => {
    expect(applyAutoPrefix("• A", "• AB", 4)).toBeNull();
  });
});

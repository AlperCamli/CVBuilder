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

  describe("Enter", () => {
    it("moves the text after a mid-line caret onto a new bullet without stray spaces", () => {
      const value = "• Led team of five";
      const caret = "• Led team".length;
      const result = applyEnter(value, caret, caret);
      expect(result.value).toBe("• Led team\n• of five");
      expect(result.value.slice(result.caret)).toBe("of five");
    });

    it("does nothing on an empty bullet, so empty bullets never pile up", () => {
      const value = "• First\n• ";
      const result = applyEnter(value, value.length, value.length);
      expect(result.value).toBe(value);
      expect(result.caret).toBe(value.length);
    });

    it("turns an empty field / empty plain line into a bullet instead of adding a blank line", () => {
      expect(applyEnter("", 0, 0)).toEqual({ value: "• ", caret: 2 });
      const value = "• First\n";
      expect(applyEnter(value, value.length, value.length)).toEqual({ value: "• First\n• ", caret: value.length + 2 });
    });

    it("never splits the marker when the caret sits before or inside it", () => {
      const value = "• First\n• Second";
      const lineStart = value.indexOf("• Second");
      for (const caret of [lineStart, lineStart + 1]) {
        const result = applyEnter(value, caret, caret);
        expect(result.value).toBe("• First\n• \n• Second");
        expect(result.value.slice(result.caret)).toBe("Second");
      }
    });

    it("pushes a plain line down unchanged when Enter is pressed at its start", () => {
      const value = "Plain paragraph.";
      const result = applyEnter(value, 0, 0);
      expect(result.value).toBe("\nPlain paragraph.");
      expect(result.caret).toBe(1);
    });

    it("adds a bullet after existing plain text (paragraph stays as the lead line)", () => {
      const value = "Prepared weekly reports.";
      const result = applyEnter(value, value.length, value.length);
      expect(result.value).toBe("Prepared weekly reports.\n• ");
    });

    it("replaces a selection, including one spanning lines", () => {
      const value = "• Alpha\n• Beta\n• Gamma";
      const start = value.indexOf("pha");
      const end = value.indexOf("ta") + 2;
      const result = applyEnter(value, start, end);
      expect(result.value).toBe("• Al\n• \n• Gamma");
    });
  });

  describe("Backspace", () => {
    it("removes an empty bullet line in one press and puts the caret at the previous line end", () => {
      const value = "• First\n• ";
      const result = applyBackspace(value, value.length, value.length);
      expect(result).toEqual({ value: "• First", caret: "• First".length });
    });

    it("removes a lone empty first bullet", () => {
      expect(applyBackspace("• ", 2, 2)).toEqual({ value: "", caret: 0 });
      expect(applyBackspace("• \n• Next", 2, 2)).toEqual({ value: "• Next", caret: 0 });
    });

    it("defers to the browser for selections", () => {
      expect(applyBackspace("• First", 2, 5)).toBeNull();
    });
  });

  describe("paste", () => {
    it("pastes a single word inline instead of breaking the sentence into a new bullet", () => {
      const caret = "• Thesis on ".length;
      expect(applyPaste("• Thesis on churn", caret, caret, "customer ")).toBeNull();
    });

    it("pastes a single line wrapped in line breaks inline without them", () => {
      const value = "• Thesis on churn";
      const caret = "• Thesis on ".length;
      const result = applyPaste(value, caret, caret, "customer \r\n");
      expect(result?.value).toBe("• Thesis on customer churn");
      expect(result?.caret).toBe("• Thesis on customer ".length);
      expect(applyPaste("", 0, 0, "Hello\n")?.value).toBe("• Hello");
    });

    it("converts CRLF / CR multi-line text into bullets", () => {
      expect(applyPaste("", 0, 0, "- Alpha\r\n- Beta\r\n")?.value).toBe("• Alpha\n• Beta");
      expect(applyPaste("", 0, 0, "Alpha\rBeta")?.value).toBe("• Alpha\n• Beta");
    });

    it("fills an empty bullet instead of leaving it empty", () => {
      const value = "• First\n• ";
      const result = applyPaste(value, value.length, value.length, "Alpha\nBeta");
      expect(result?.value).toBe("• First\n• Alpha\n• Beta");
      expect(result?.caret).toBe(result?.value.length);
    });

    it("moves the text after the caret onto its own bullet below the pasted lines", () => {
      const value = "• Built X and Y";
      const caret = "• Built X".length;
      const result = applyPaste(value, caret, caret, "one\ntwo");
      expect(result?.value).toBe("• Built X\n• one\n• two\n• and Y");
      expect(result?.value.slice(result.caret)).toBe("\n• and Y");
    });

    it("replaces a selected range", () => {
      const value = "• Old text";
      const result = applyPaste(value, 0, value.length, "New A\nNew B");
      expect(result?.value).toBe("• New A\n• New B");
    });
  });

  it("does not auto-prefix whitespace or text that already starts as a bullet", () => {
    expect(applyAutoPrefix("", " ", 1)).toBeNull();
    expect(applyAutoPrefix("", "- Pasted", 8)).toBeNull();
  });
});

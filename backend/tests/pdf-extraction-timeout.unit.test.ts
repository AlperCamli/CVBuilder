import { describe, expect, it } from "vitest";
import { withTimeout } from "../src/modules/imports/parsers/simple-cv-parser";

describe("PDF extraction timeouts", () => {
  it("rejects a stage that never settles so the parser can fall back", async () => {
    await expect(withTimeout(new Promise(() => undefined), 10, "OCR")).rejects.toThrow("OCR timed out");
  });
  it("passes through results and errors that arrive in time", async () => {
    await expect(withTimeout(Promise.resolve("text"), 1_000, "OCR")).resolves.toBe("text");
    await expect(withTimeout(Promise.reject(new Error("bad pdf")), 1_000, "OCR")).rejects.toThrow("bad pdf");
  });
});

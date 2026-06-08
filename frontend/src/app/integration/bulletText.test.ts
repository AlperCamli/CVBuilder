import { describe, expect, it } from "vitest";
import {
  BULLET_MARKER,
  addBulletPrefix,
  isBulletLine,
  isWholeFieldBulletList,
  looksLikeBulletAnswer,
  normalizeToBullets,
  splitBulletLines,
  stripBulletPrefix
} from "./bulletText";

describe("bulletText", () => {
  it("detects bullet lines for several markers but not plain text or hyphenated words", () => {
    expect(isBulletLine("• Did a thing")).toBe(true);
    expect(isBulletLine("- Did a thing")).toBe(true);
    expect(isBulletLine("* Did a thing")).toBe(true);
    expect(isBulletLine("1. Did a thing")).toBe(true);
    expect(isBulletLine("2) Did a thing")).toBe(true);
    expect(isBulletLine("Did a thing")).toBe(false);
    expect(isBulletLine("well-known result")).toBe(false);
    expect(isBulletLine("-5 degrees")).toBe(false);
  });

  it("strips and adds the marker idempotently", () => {
    expect(stripBulletPrefix("• Hello")).toBe("Hello");
    expect(stripBulletPrefix("- Hello")).toBe("Hello");
    expect(stripBulletPrefix("Hello")).toBe("Hello");
    expect(addBulletPrefix("Hello")).toBe(`${BULLET_MARKER}Hello`);
    expect(addBulletPrefix("• Hello")).toBe(`${BULLET_MARKER}Hello`);
    expect(addBulletPrefix(addBulletPrefix("- Hello"))).toBe(`${BULLET_MARKER}Hello`);
  });

  it("normalizes mixed list markers and plain newlines into a • list, dropping blanks", () => {
    const input = "- First\n2. Second\n\n• Third\nFourth";
    expect(normalizeToBullets(input)).toBe("• First\n• Second\n• Third\n• Fourth");
    expect(normalizeToBullets("")).toBe("");
  });

  it("splits a lead paragraph from the bullet entries", () => {
    expect(splitBulletLines("Lead sentence\n• A\n• B")).toEqual({
      leadParagraph: "Lead sentence",
      bullets: ["A", "B"]
    });
    expect(splitBulletLines("• A\n• B")).toEqual({
      leadParagraph: null,
      bullets: ["A", "B"]
    });
    expect(splitBulletLines("Just a paragraph")).toEqual({
      leadParagraph: "Just a paragraph",
      bullets: []
    });
  });

  it("folds wrapped continuation lines into the previous bullet", () => {
    expect(splitBulletLines("• Designed pipeline\n  end to end")).toEqual({
      leadParagraph: null,
      bullets: ["Designed pipeline end to end"]
    });
  });

  it("recognizes whole-field bullet lists", () => {
    expect(isWholeFieldBulletList("• A\n• B")).toBe(true);
    expect(isWholeFieldBulletList("Lead\n• A")).toBe(false);
    expect(isWholeFieldBulletList("")).toBe(false);
  });

  it("flags multi-line or marked answers as bullet answers, single prose lines are not", () => {
    expect(looksLikeBulletAnswer("Did A\nDid B")).toBe(true);
    expect(looksLikeBulletAnswer("- Did A")).toBe(true);
    expect(looksLikeBulletAnswer("A single improved sentence.")).toBe(false);
  });
});

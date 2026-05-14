import { describe, expect, it } from "vitest";
import type { EditorSection } from "../integration/cv-mappers";
import {
  canUseAiForSectionBlock,
  hasContentForAi,
  matchesBlockReference,
  resolveCanonicalAiBlockId
} from "./cv-editor-ai-guard";

const makeSection = (type: string, data: Record<string, unknown>): EditorSection => ({
  id: `${type}-section`,
  type,
  hidden: false,
  order: 0,
  data
});

describe("cv-editor-ai-guard", () => {
  it("requires non-empty summary text", () => {
    const emptySummary = makeSection("summary", { text: "   " });
    const filledSummary = makeSection("summary", { text: "Product manager with 6 years of experience" });

    expect(hasContentForAi(emptySummary)).toBe(false);
    expect(hasContentForAi(filledSummary)).toBe(true);
    expect(canUseAiForSectionBlock(filledSummary)).toBe(true);
  });

  it("requires at least one non-empty skill value", () => {
    const emptySkills = makeSection("skills", { skills: ["", "   "] });
    const filledSkills = makeSection("skills", { skills: ["TypeScript"] });

    expect(hasContentForAi(emptySkills)).toBe(false);
    expect(hasContentForAi(filledSkills)).toBe(true);
  });

  it("blocks AI on experience item when description is empty", () => {
    const experienceSection = makeSection("experience", {
      items: [
        {
          id: "local-1",
          blockId: "exp-1",
          role: "Frontend Engineer",
          company: "Acme",
          description: "   "
        }
      ]
    });

    expect(hasContentForAi(experienceSection, "exp-1")).toBe(true);
    expect(canUseAiForSectionBlock(experienceSection, "exp-1")).toBe(false);
  });

  it("allows AI on experience item only when description is filled", () => {
    const experienceSection = makeSection("experience", {
      items: [
        {
          id: "local-1",
          blockId: "exp-1",
          role: "Frontend Engineer",
          company: "Acme",
          description: "Built reusable components and improved load time by 30%."
        }
      ]
    });

    expect(hasContentForAi(experienceSection, "exp-1")).toBe(true);
    expect(canUseAiForSectionBlock(experienceSection, "exp-1")).toBe(true);
  });

  it("uses local item id for first-click empty experience guard before blockId exists", () => {
    const experienceSection = makeSection("experience", {
      items: [
        {
          id: "local-new-item",
          role: "Backend Engineer",
          company: "Acme",
          description: ""
        }
      ]
    });

    expect(hasContentForAi(experienceSection, "local-new-item")).toBe(true);
    expect(canUseAiForSectionBlock(experienceSection, "local-new-item")).toBe(false);
    expect(resolveCanonicalAiBlockId(experienceSection, "local-new-item")).toBeNull();
  });

  it("does not fall back to another item when explicit block reference does not match", () => {
    const experienceSection = makeSection("experience", {
      items: [
        {
          id: "local-1",
          blockId: "exp-1",
          role: "Designer",
          company: "Acme",
          description: "Created a new design system."
        },
        {
          id: "local-2",
          blockId: "exp-2",
          role: "",
          company: "",
          description: ""
        }
      ]
    });

    expect(hasContentForAi(experienceSection, "missing-block")).toBe(false);
    expect(canUseAiForSectionBlock(experienceSection, "missing-block")).toBe(false);
  });

  it("supports canonical block-id resolution for item or section references", () => {
    const educationSection = makeSection("education", {
      blockId: "edu-section-block",
      items: [
        {
          id: "edu-local-1",
          blockId: "edu-item-1",
          institution: "Tech University",
          degree: "BSc",
          fieldOfStudy: "Computer Science",
          description: "Graduated with honors"
        }
      ]
    });

    expect(resolveCanonicalAiBlockId(educationSection, "edu-local-1")).toBe("edu-item-1");
    expect(resolveCanonicalAiBlockId(educationSection, "edu-section-block")).toBe("edu-section-block");
    expect(resolveCanonicalAiBlockId(educationSection)).toBe("edu-section-block");
  });

  it("accepts non-empty generic item blocks", () => {
    const genericSection = makeSection("custom", {
      items: [
        {
          id: "custom-1",
          blockId: "custom-block-1",
          label: "Hackathon Winner",
          details: "Won first place in a fintech competition."
        }
      ]
    });

    expect(hasContentForAi(genericSection, "custom-block-1")).toBe(true);
    expect(canUseAiForSectionBlock(genericSection, "custom-block-1")).toBe(true);
  });

  it("matches block references by backend blockId or local id", () => {
    const item = { id: "local-77", blockId: "backend-77" };

    expect(matchesBlockReference(item, "backend-77")).toBe(true);
    expect(matchesBlockReference(item, "local-77")).toBe(true);
    expect(matchesBlockReference(item, "unknown")).toBe(false);
  });
});

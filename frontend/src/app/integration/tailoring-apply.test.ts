import { describe, expect, it } from "vitest";
import type { CvContent } from "./api-types";
import { cvContentToEditorSections, editorSectionsToCvContent } from "./cv-mappers";
import {
  applyTailoringSuggestion,
  isTailoringSuggestionStale,
  isTailoringUndoBlocked,
  planTailoringAutoApply,
  revertTailoringSuggestion,
  tailoringSuggestedSkills
} from "./tailoring-apply";
import type { TailoringSuggestion } from "./tailoring-types";

const content = (): CvContent => ({
  version: "v1",
  language: "en",
  metadata: {},
  sections: [
    {
      id: "exp-s",
      type: "experience",
      title: "Experience",
      order: 0,
      meta: {},
      blocks: [
        {
          id: "exp-1",
          type: "experience_item",
          order: 0,
          visibility: "visible",
          meta: {},
          fields: { role: "Engineer", company: "Acme", description: "• Built APIs" }
        }
      ]
    },
    {
      id: "skills-s",
      type: "skills",
      title: "Skills",
      order: 1,
      meta: {},
      blocks: [{ id: "skills-b", type: "skills", order: 0, visibility: "visible", meta: {}, fields: { skills: ["Go"] } }]
    },
    {
      id: "hobby-s",
      type: "hobbies",
      title: "Hobbies",
      order: 2,
      meta: {},
      blocks: [{ id: "hobby-b", type: "custom", order: 0, visibility: "visible", meta: {}, fields: { text: "Chess" } }]
    }
  ]
});

const suggestion = (patch: Partial<TailoringSuggestion>): TailoringSuggestion => ({
  id: "s1",
  task_id: "t1",
  kind: "rewrite",
  block_id: null,
  section_id: null,
  before: null,
  suggested: {},
  rationale: "",
  requirement_ids: [],
  add_to_main: false,
  guard_notes: [],
  status: "pending",
  created_at: "2026-10-27T00:00:00.000Z",
  ...patch
});

describe("tailoring suggestions on CV content", () => {
  it("applies and reverts a block rewrite, and detects stale suggestions", () => {
    const rewrite = suggestion({
      block_id: "exp-1",
      before: { field: "description", value: "• Built APIs" },
      suggested: { field: "description", value: "• Built payment APIs\n• Led on-call" }
    });

    expect(isTailoringSuggestionStale(content(), rewrite)).toBe(false);
    const applied = applyTailoringSuggestion(content(), rewrite)!;
    expect(applied.sections[0].blocks[0].fields.description).toBe("• Built payment APIs\n• Led on-call");

    const reverted = revertTailoringSuggestion(applied, rewrite)!;
    expect(reverted.sections[0].blocks[0].fields.description).toBe("• Built APIs");

    const edited = applyTailoringSuggestion(content(), rewrite, "• Something the user typed")!;
    expect(revertTailoringSuggestion(edited, rewrite)).toBeNull();
    expect(isTailoringSuggestionStale(edited, rewrite)).toBe(true);
  });

  it("inserts a new summary section first and reorders sections in place", () => {
    const newSummary = suggestion({
      kind: "new_section",
      suggested: {
        position: "first",
        section: {
          id: "summary-new",
          type: "summary",
          title: "Professional Summary",
          order: 0,
          meta: {},
          blocks: [{ id: "summary-b", type: "summary", order: 0, visibility: "visible", meta: {}, fields: { text: "Payments engineer." } }]
        }
      }
    });
    const withSummary = applyTailoringSuggestion(content(), newSummary)!;
    expect(withSummary.sections.map((section) => section.id)).toEqual(["summary-new", "exp-s", "skills-s", "hobby-s"]);

    const reorder = suggestion({
      kind: "reorder",
      before: { section_order: ["exp-s", "skills-s"] },
      suggested: { section_order: ["skills-s", "exp-s"] }
    });
    const reordered = applyTailoringSuggestion(withSummary, reorder)!;
    expect(reordered.sections.map((section) => section.id)).toEqual(["summary-new", "skills-s", "exp-s", "hobby-s"]);
    expect(revertTailoringSuggestion(reordered, reorder)!.sections.map((section) => section.id)).toEqual([
      "summary-new",
      "exp-s",
      "skills-s",
      "hobby-s"
    ]);
    expect(revertTailoringSuggestion(withSummary, newSummary)!.sections.map((section) => section.id)).toEqual([
      "exp-s",
      "skills-s",
      "hobby-s"
    ]);
  });

  it("hides and restores a section", () => {
    const hide = suggestion({ kind: "hide_section", suggested: { section_id: "hobby-s" } });
    const hidden = applyTailoringSuggestion(content(), hide)!;
    expect(hidden.sections[2].meta.visibility).toBe("hidden");
    expect(hidden.sections[2].blocks[0].visibility).toBe("hidden");
    expect(revertTailoringSuggestion(hidden, hide)!.sections[2].meta.visibility).toBeUndefined();
  });

  it("keeps block ids through the editor mapping so applied changes persist", () => {
    const rewrite = suggestion({
      block_id: "exp-1",
      before: { field: "description", value: "• Built APIs" },
      suggested: { field: "description", value: "• Built payment APIs" }
    });
    const skills = suggestion({
      id: "s2",
      kind: "skills",
      block_id: "skills-b",
      before: { field: "skills", value: ["Go"] },
      suggested: { field: "skills", value: ["Payments", "Go"] }
    });

    const applied = applyTailoringSuggestion(applyTailoringSuggestion(content(), rewrite)!, skills)!;
    const roundTrip = editorSectionsToCvContent(cvContentToEditorSections(applied, "standard"), "en", undefined, "standard");
    const experience = roundTrip.sections.flatMap((section) => section.blocks).find((block) => block.id === "exp-1");
    const skillsBlock = roundTrip.sections.flatMap((section) => section.blocks).find((block) => block.id === "skills-b");

    expect(experience?.fields.description).toBe("• Built payment APIs");
    expect(skillsBlock?.fields.skills).toEqual(["Payments", "Go"]);
    expect(isTailoringSuggestionStale(roundTrip, rewrite)).toBe(true);
    expect(isTailoringSuggestionStale(roundTrip, { ...rewrite, before: { field: "description", value: "• Built payment APIs" } })).toBe(false);
  });

  it("lets auto-apply accept only suggestions whose part of the CV is unchanged", () => {
    const rewrite = suggestion({
      id: "fresh",
      block_id: "exp-1",
      before: { field: "description", value: "• Built APIs" },
      suggested: { field: "description", value: "• Built payment APIs" }
    });
    const staleSkills = suggestion({
      id: "stale",
      kind: "skills",
      block_id: "skills-b",
      before: { field: "skills", value: ["Rust"] },
      suggested: { field: "skills", value: ["Payments", "Rust"] }
    });
    const missingBlock = suggestion({
      id: "missing",
      block_id: "gone",
      before: { field: "text", value: "" },
      suggested: { field: "text", value: "New" }
    });
    const hide = suggestion({ id: "hide", kind: "hide_section", suggested: { section_id: "hobby-s" } });
    const decided = suggestion({ ...rewrite, id: "decided", status: "rejected" });

    const plan = planTailoringAutoApply(content(), [rewrite, staleSkills, missingBlock, hide, decided, rewrite]);
    expect(plan.accept.map((item) => item.id)).toEqual(["fresh", "hide"]);
    expect(plan.skipped.map((item) => item.id)).toEqual(["stale", "missing"]);
  });

  it("checks each auto-apply candidate against the content after the earlier ones", () => {
    const first = suggestion({
      id: "first",
      block_id: "exp-1",
      before: { field: "description", value: "• Built APIs" },
      suggested: { field: "description", value: "• Built payment APIs" }
    });
    // Generated from the same original text: applying the first makes it stale.
    const second = suggestion({ ...first, id: "second", suggested: { field: "description", value: "• Led on-call" } });
    const plan = planTailoringAutoApply(content(), [first, second]);
    expect(plan.accept.map((item) => item.id)).toEqual(["first"]);
    expect(plan.skipped.map((item) => item.id)).toEqual(["second"]);
  });

  it("blocks undo only for applied suggestions edited afterwards", () => {
    const rewrite = suggestion({
      block_id: "exp-1",
      status: "applied",
      before: { field: "description", value: "• Built APIs" },
      suggested: { field: "description", value: "• Built payment APIs" }
    });
    const applied = applyTailoringSuggestion(content(), rewrite)!;
    expect(isTailoringUndoBlocked(applied, rewrite)).toBe(false);
    const editedLater = applyTailoringSuggestion(applied, rewrite, "• Typed by the user")!;
    expect(isTailoringUndoBlocked(editedLater, rewrite)).toBe(true);
    expect(isTailoringUndoBlocked(editedLater, { ...rewrite, status: "rejected" })).toBe(false);
  });

  it("applies an edited skill list to a skills card and to a new skills section", () => {
    const skills = suggestion({
      kind: "skills",
      block_id: "skills-b",
      before: { field: "skills", value: ["Go"] },
      suggested: { field: "skills", value: ["Go", "SQL", "Kafka"] }
    });
    expect(tailoringSuggestedSkills(skills)).toEqual(["Go", "SQL", "Kafka"]);
    const edited = applyTailoringSuggestion(content(), skills, ["SQL", "Go"])!;
    expect(edited.sections[1].blocks[0].fields.skills).toEqual(["SQL", "Go"]);

    const newSection = suggestion({
      kind: "new_section",
      suggested: {
        position: "last",
        section: {
          id: "new-skills",
          type: "skills",
          title: "Skills",
          order: 0,
          meta: {},
          blocks: [{ id: "new-skills-b", type: "skills", order: 0, visibility: "visible", meta: {}, fields: { skills: ["SQL", "Tableau"] } }]
        }
      }
    });
    expect(tailoringSuggestedSkills(newSection)).toEqual(["SQL", "Tableau"]);
    const added = applyTailoringSuggestion(content(), newSection, ["Tableau"])!;
    expect(added.sections.find((item) => item.id === "new-skills")!.blocks[0].fields.skills).toEqual(["Tableau"]);
    // An edit stored on the card (after reload) is used too.
    const stored = { ...newSection, suggested: { ...newSection.suggested, value: ["SQL"] } };
    expect(tailoringSuggestedSkills(stored)).toEqual(["SQL"]);
    expect(applyTailoringSuggestion(content(), stored)!.sections.find((item) => item.id === "new-skills")!.blocks[0].fields.skills).toEqual(["SQL"]);
    expect(revertTailoringSuggestion(added, newSection)!.sections.some((item) => item.id === "new-skills")).toBe(false);
    expect(tailoringSuggestedSkills(suggestion({ kind: "rewrite" }))).toBeNull();
  });

  it("writes back to whatever field the card names (summary, highlights, items)", () => {
    const base: CvContent = {
      ...content(),
      sections: [
        {
          id: "sum-s",
          type: "summary",
          title: null,
          order: 0,
          meta: {},
          blocks: [{ id: "sum-b", type: "profile", order: 0, visibility: "visible", meta: {}, fields: { summary: "Old summary" } }]
        },
        {
          id: "job-s",
          type: "experience",
          title: null,
          order: 1,
          meta: {},
          blocks: [{ id: "job-b", type: "job", order: 0, visibility: "visible", meta: {}, fields: { title: "Analyst", highlights: "• Old" } }]
        },
        {
          id: "sk-s",
          type: "skills",
          title: null,
          order: 2,
          meta: {},
          blocks: [{ id: "sk-b", type: "skills", order: 0, visibility: "visible", meta: {}, fields: { items: ["Go"] } }]
        }
      ]
    };
    const summary = suggestion({ block_id: "sum-b", before: { field: "summary", value: "Old summary" }, suggested: { field: "summary", value: "New summary" } });
    const bullets = suggestion({ id: "s2", block_id: "job-b", before: { field: "highlights", value: "• Old" }, suggested: { field: "highlights", value: "• New" } });
    const skills = suggestion({ id: "s3", kind: "skills", block_id: "sk-b", before: { field: "items", value: ["Go"] }, suggested: { field: "items", value: ["Go", "SQL"] } });

    expect(isTailoringSuggestionStale(base, summary)).toBe(false);
    let next = applyTailoringSuggestion(base, summary)!;
    next = applyTailoringSuggestion(next, bullets)!;
    next = applyTailoringSuggestion(next, skills, ["SQL"])!;
    expect(next.sections[0].blocks[0].fields).toEqual({ summary: "New summary" });
    expect(next.sections[1].blocks[0].fields).toEqual({ title: "Analyst", highlights: "• New" });
    expect(next.sections[2].blocks[0].fields).toEqual({ items: ["SQL"] });
    expect(revertTailoringSuggestion(next, bullets)!.sections[1].blocks[0].fields.highlights).toBe("• Old");

    const newSection = suggestion({
      id: "s4",
      kind: "new_section",
      suggested: {
        section: { id: "n", type: "skills", title: null, order: 0, meta: {}, blocks: [{ id: "nb", type: "skills", order: 0, visibility: "visible", meta: {}, fields: { items: ["SQL", "Go"] } }] }
      }
    });
    expect(tailoringSuggestedSkills(newSection)).toEqual(["SQL", "Go"]);
    expect(applyTailoringSuggestion(content(), newSection, ["Go"])!.sections.find((item) => item.id === "n")!.blocks[0].fields).toEqual({ items: ["Go"] });
  });
});

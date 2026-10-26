import { describe, expect, it } from "vitest";
import { addCustomSkill, buildSkillChoices, selectedSkills, toggleSkillChoice } from "./skill-choices";

describe("skill chip choices", () => {
  it("lists suggested skills first (selected), then current skills left out (not selected)", () => {
    const choices = buildSkillChoices(["SQL", "Tableau", "Excel"], ["Excel", "Python", "sql"]);
    expect(choices.map((choice) => [choice.name, choice.selected, choice.isNew])).toEqual([
      ["SQL", true, false],
      ["Tableau", true, true],
      ["Excel", true, false],
      ["Python", false, false]
    ]);
    expect(selectedSkills(choices)).toEqual(["SQL", "Tableau", "Excel"]);
  });

  it("dedupes case- and whitespace-insensitively and drops empty names", () => {
    const choices = buildSkillChoices(["  Power   BI ", "power bi", ""], ["POWER BI"]);
    expect(choices).toEqual([{ name: "Power BI", key: "power bi", isNew: false, selected: true }]);
  });

  it("toggles chips and keeps the order", () => {
    let choices = buildSkillChoices(["SQL", "Tableau"], ["Python"]);
    choices = toggleSkillChoice(choices, "tableau");
    choices = toggleSkillChoice(choices, "python");
    expect(selectedSkills(choices)).toEqual(["SQL", "Python"]);
    choices = toggleSkillChoice(choices, "tableau");
    expect(selectedSkills(choices)).toEqual(["SQL", "Tableau", "Python"]);
  });

  it("adds custom skills at the end, or reselects an existing one", () => {
    let choices = buildSkillChoices(["SQL"], ["Python"]);
    choices = addCustomSkill(choices, " Looker ", ["Python"]);
    expect(choices[choices.length - 1]).toEqual({ name: "Looker", key: "looker", isNew: true, selected: true });
    choices = addCustomSkill(choices, "python", ["Python"]);
    expect(choices.filter((choice) => choice.key === "python")).toHaveLength(1);
    expect(selectedSkills(choices)).toEqual(["SQL", "Python", "Looker"]);
    expect(addCustomSkill(choices, "   ", [])).toBe(choices);
  });
});

// Chip selection for editing a skills suggestion: the suggested skills first (selected),
// then current skills the suggestion leaves out (not selected), then custom additions.

export interface SkillChoice {
  name: string;
  key: string;
  // Not in the CV's current skills.
  isNew: boolean;
  selected: boolean;
}

export const skillKey = (name: string): string => name.replace(/\s+/g, " ").trim().toLowerCase();

const clean = (name: string): string => name.replace(/\s+/g, " ").trim();

export const buildSkillChoices = (suggested: string[], current: string[]): SkillChoice[] => {
  const currentKeys = new Set(current.map(skillKey).filter(Boolean));
  const choices: SkillChoice[] = [];
  const seen = new Set<string>();
  const push = (name: string, selected: boolean) => {
    const key = skillKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    choices.push({ name: clean(name), key, isNew: !currentKeys.has(key), selected });
  };
  suggested.forEach((name) => push(name, true));
  current.forEach((name) => push(name, false));
  return choices;
};

export const toggleSkillChoice = (choices: SkillChoice[], key: string): SkillChoice[] =>
  choices.map((choice) => (choice.key === key ? { ...choice, selected: !choice.selected } : choice));

// Adds a custom skill (selected). A skill already in the list is selected instead of duplicated.
export const addCustomSkill = (choices: SkillChoice[], name: string, current: string[]): SkillChoice[] => {
  const key = skillKey(name);
  if (!key) return choices;
  if (choices.some((choice) => choice.key === key)) {
    return choices.map((choice) => (choice.key === key ? { ...choice, selected: true } : choice));
  }
  const isNew = !current.some((item) => skillKey(item) === key);
  return [...choices, { name: clean(name), key, isNew, selected: true }];
};

export const selectedSkills = (choices: SkillChoice[]): string[] =>
  choices.filter((choice) => choice.selected).map((choice) => choice.name);

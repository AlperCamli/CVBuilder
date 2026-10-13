import { translate } from "./i18n";

/** Translate generated review prose through the same editable UI catalog. */
export function reviewText(text: string): string {
  const direct = translate(text);
  if (direct !== text) return direct;
  const patterns: Array<[RegExp, string, string[]]> = [
    [
      /^(\d+)\/(\d+) job terms appear in contextual content: (.*)\.$/,
      "{{found}}/{{total}} job terms appear in contextual content: {{terms}}.",
      ["found", "total", "terms"],
    ],
    [
      /^(\d+)\/(\d+) target title terms found\.$/,
      "{{found}}/{{total}} target title terms found.",
      ["found", "total"],
    ],
    [
      /^(\d+)\/(\d+) terms found\. Missing: (.*)\.$/,
      "{{found}}/{{total}} terms found. Missing: {{terms}}.",
      ["found", "total", "terms"],
    ],
    [
      /^(\d+) populated sections; (\d+) duplicate headings\.$/,
      "{{sections}} populated sections; {{duplicates}} duplicate headings.",
      ["sections", "duplicates"],
    ],
    [
      /^(\d+) empty sections and (\d+) empty visible blocks\.$/,
      "{{sections}} empty sections and {{blocks}} empty visible blocks.",
      ["sections", "blocks"],
    ],
    [
      /^(\d+)\/(\d+) unique experience statements include measurable scope or results; full credit at 50%\.(.*)$/,
      "{{found}}/{{total}} unique experience statements include measurable scope or results; full credit at 50%.{{example}}",
      ["found", "total", "example"],
    ],
    [
      /^(\d+)\/(\d+) unique statements contain 6–45 words\.(.*)$/,
      "{{found}}/{{total}} unique statements contain 6–45 words.{{example}}",
      ["found", "total", "example"],
    ],
    [
      /^(\d+)\/(\d+) unique statements begin with a recognized action verb\.(.*)$/,
      "{{found}}/{{total}} unique statements begin with a recognized action verb.{{example}}",
      ["found", "total", "example"],
    ],
    [
      /^(\d+)\/(\d+) statements avoid the checked generic phrases\.(.*)$/,
      "{{found}}/{{total}} statements avoid the checked generic phrases.{{example}}",
      ["found", "total", "example"],
    ],
    [
      /^(high|medium|low) extraction confidence \((\d+)\/100\)\.$/,
      "{{confidence}} extraction confidence ({{score}}/100).",
      ["confidence", "score"],
    ],
    [
      /^Tailoring increased the review score by (\d+) points against the same job criteria\.$/,
      "Tailoring increased the review score by {{points}} points against the same job criteria.",
      ["points"],
    ],
    [
      /^The review score decreased by (\d+) points\. Review the changes before applying\.$/,
      "The review score decreased by {{points}} points. Review the changes before applying.",
      ["points"],
    ],
  ];
  for (const [pattern, template, names] of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const values = Object.fromEntries(
      names.map((name, index) => {
        const value = match[index + 1];
        return [
          name,
          name === "confidence"
            ? translate(value)
            : name === "example"
              ? value.replace(/ Example: /g, ` ${translate("Example:")} `)
              : value === "none"
                ? translate("none")
                : value,
        ];
      }),
    );
    return translate(template, values);
  }
  return text
    .split(/(?<=\.)\s+|(?<=;)\s+/)
    .map((part) => translate(part))
    .join(" ");
}

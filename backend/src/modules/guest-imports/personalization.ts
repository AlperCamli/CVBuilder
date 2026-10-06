import { guestAnswersSchema } from "./guest-imports.schemas";
const CAREER: Record<string, string> = {
  student:
    "Emphasize existing projects, placements and transferable skills for someone starting their career.",
  early: "Make contributions in early career roles clear and concrete.",
  experienced:
    "Prioritize relevant achievements and impact for an experienced professional.",
  change: "Connect existing transferable skills to a career change.",
  return:
    "Highlight existing strengths and experience for someone returning to work.",
};
export function personalizationGuidance(input: unknown): string[] {
  const parsed = guestAnswersSchema.safeParse(input);
  if (
    !parsed.success ||
    !Object.keys(parsed.data).some((key) => key !== "source")
  )
    return [];
  const { goal, career, education } = parsed.data;
  return [
    "The following onboarding preferences are guidance, not verified CV facts. Never add degrees, roles, skills or achievements based on them. Preserve all existing facts.",
    ...(career && CAREER[career] ? [CAREER[career]] : []),
    ...(goal === "tailor"
      ? [
          "Focus wording on relevance to the supplied target role, when available.",
        ]
      : []),
    ...(goal === "improve"
      ? ["Prioritize clear, specific achievement wording."]
      : []),
    ...(education === "vocational"
      ? ["Make existing professional training and certifications easy to find."]
      : []),
    ...(education === "doctorate"
      ? ["Retain relevant existing research and publications."]
      : []),
  ];
}

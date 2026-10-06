import {
  ArrowLeftRight,
  BookOpen,
  BriefcaseBusiness,
  Compass,
  FileCheck2,
  GraduationCap,
  HeartHandshake,
  Megaphone,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type QuestionId = "goal" | "career" | "education" | "source";
export type OnboardingAnswers = Partial<Record<QuestionId, string>>;

export interface OnboardingQuestion {
  id: QuestionId;
  eyebrow: string;
  title: string;
  description: string;
  options: {
    value: string;
    label: string;
    detail?: string;
    icon: LucideIcon;
  }[];
  encouragement: string;
}

export const PRE_SIGNUP_QUESTIONS: OnboardingQuestion[] = [
  {
    id: "goal",
    eyebrow: "YOUR NEXT MOVE",
    title: "What would you like to do first?",
    description: "We'll help you start with what matters most to you.",
    options: [
      {
        value: "tailor",
        label: "Tailor my CV to a job",
        detail: "Make my experience relevant to a specific role",
        icon: Target,
      },
      {
        value: "improve",
        label: "Improve my existing CV",
        detail: "Polish the wording, structure, and impact",
        icon: Sparkles,
      },
      {
        value: "design",
        label: "Give my CV a fresh look",
        detail: "Find a clean, professional template",
        icon: FileCheck2,
      },
      {
        value: "explore",
        label: "I'm just exploring",
        detail: "See what I can do with my CV",
        icon: Compass,
      },
    ],
    encouragement:
      "One CV. Plenty of possibilities. Let's find your starting point.",
  },
  {
    id: "career",
    eyebrow: "YOUR EXPERIENCE",
    title: "Where are you in your career?",
    description: "This helps us suggest the right focus for your CV.",
    options: [
      {
        value: "student",
        label: "Studying or just graduated",
        detail: "Ready for my first opportunity",
        icon: BookOpen,
      },
      {
        value: "early",
        label: "Early in my career",
        detail: "Building on my first few years of experience",
        icon: BriefcaseBusiness,
      },
      {
        value: "experienced",
        label: "An experienced professional",
        detail: "Ready for my next role or a step up",
        icon: TrendingUp,
      },
      {
        value: "change",
        label: "Making a career change",
        detail: "Taking my skills in a new direction",
        icon: ArrowLeftRight,
      },
      {
        value: "return",
        label: "Returning to work",
        detail: "Starting my next chapter after a break",
        icon: HeartHandshake,
      },
    ],
    encouragement: "Every career has its own story. Your CV should tell yours.",
  },
  {
    id: "education",
    eyebrow: "YOUR BACKGROUND",
    title: "What is your education level?",
    description:
      "Choose your highest level, completed or currently in progress.",
    options: [
      { value: "secondary", label: "Secondary / high school", icon: BookOpen },
      {
        value: "vocational",
        label: "Vocational / professional training",
        icon: Wrench,
      },
      {
        value: "associate",
        label: "Associate degree / diploma",
        icon: FileCheck2,
      },
      { value: "bachelor", label: "Bachelor's degree", icon: GraduationCap },
      { value: "master", label: "Master's degree", icon: GraduationCap },
      { value: "doctorate", label: "Doctorate / PhD", icon: GraduationCap },
      { value: "other", label: "Another path", icon: Compass },
    ],
    encouragement:
      "Degrees, training, and life experience. There is more than one way forward.",
  },
  {
    id: "source",
    eyebrow: "ONE LAST THING",
    title: "How did you hear about us?",
    description: "Help us understand how people find jobspecificCV.",
    options: [
      {
        value: "search",
        label: "Google or another search engine",
        icon: Search,
      },
      { value: "social", label: "Social media", icon: Megaphone },
      { value: "friend", label: "A friend or colleague", icon: Users },
      {
        value: "community",
        label: "University or career community",
        icon: GraduationCap,
      },
      {
        value: "article",
        label: "An article, video, or newsletter",
        icon: BookOpen,
      },
      { value: "other", label: "Somewhere else", icon: Compass },
    ],
    encouragement:
      "You're almost there. Your next chapter is ready to take shape.",
  },
];

export function answerLabel(
  id: QuestionId,
  answers: OnboardingAnswers,
): string {
  return (
    PRE_SIGNUP_QUESTIONS.find((question) => question.id === id)?.options.find(
      (option) => option.value === answers[id],
    )?.label ?? "Skipped"
  );
}

const GOAL_GUIDANCE: Record<string, string> = {
  tailor: "Start with a job description to focus your CV on the role you want.",
  improve:
    "Start with your summary and make each achievement clear and specific.",
  design: "Start with a template, then adjust the spacing and typography.",
  explore: "Explore your CV's sections and try a few different templates.",
};

const CAREER_GUIDANCE: Record<string, string> = {
  student:
    "Bring projects, placements, and transferable skills into the spotlight.",
  early:
    "Show what you contributed in your first roles with concrete examples.",
  experienced:
    "Lead with your most relevant achievements and the impact you made.",
  change: "Connect your transferable skills to the direction you're moving in.",
  return:
    "Highlight your strengths and relevant experience as you return to work.",
};

/** Referral source never influences CV recommendations. */
export function personalizedGuidance(answers: OnboardingAnswers): string[] {
  const goal =
    GOAL_GUIDANCE[answers.goal ?? ""] ??
    "Review your CV's sections, then choose what to improve first.";
  const career =
    CAREER_GUIDANCE[answers.career ?? ""] ??
    "Keep your experience accurate and focused on your strengths.";
  const education =
    answers.education === "vocational"
      ? "Give professional training and certifications a clear place in your CV."
      : answers.education === "doctorate"
        ? "Include relevant research and publications when they support your application."
        : answers.education && answers.education !== "other"
          ? "Check your education details and make any in-progress study clear."
          : "Include the learning, training, and qualifications relevant to your next role.";
  return [goal, career, education];
}

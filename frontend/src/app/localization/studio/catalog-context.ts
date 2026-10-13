import { SOURCE_KEYS } from "./language-catalog";

export const TEXT_AREAS = [
  "Landing & mascot",
  "Authentication",
  "Onboarding",
  "Dashboard & CVs",
  "CV editor",
  "Tailoring & AI",
  "Templates",
  "Billing",
  "Applications & letters",
  "Privacy & account",
  "Shared & messages",
];
const sources = import.meta.glob<string>(
  "../../{pages,components,integration,contexts}/**/*.{tsx,ts}",
  { query: "?raw", import: "default", eager: true },
);
const keys = new Set(SOURCE_KEYS);
const contexts = new Map<string, Set<string>>();
function area(path: string): string {
  if (/MascotStudio|LanguageStudio|Exploration|DesignGallery/.test(path))
    return "";
  if (/Pricing|Subscription|Upgrade|billing|pricing|checkout/i.test(path))
    return "Billing";
  if (/SignIn|SignUp|ForgotPassword|ResetPassword|EmailSent|auth-/.test(path))
    return "Authentication";
  if (/Onboarding|CreateOrUpload|UploadProcessing/.test(path))
    return "Onboarding";
  if (/Template/.test(path)) return "Templates";
  if (/Tailor|AIImproving|AIBlock|CVScore|CvReview/.test(path))
    return "Tailoring & AI";
  if (/CoverLetter|JobTracker/.test(path)) return "Applications & letters";
  if (/Privacy|Profile|privacy/.test(path)) return "Privacy & account";
  if (
    /CVEditor|CVSections|SpecializedSections|AddContent|ModuleSection|Bullet|Collapsible/.test(
      path,
    )
  )
    return "CV editor";
  if (/Dashboard|Resumes|MasterRevision|TranslationDialog/.test(path))
    return "Dashboard & CVs";
  if (/designs|GuidedJourney|Landing|PublicHeader/.test(path))
    return "Landing & mascot";
  return "Shared & messages";
}
for (const [path, source] of Object.entries(sources)) {
  const section = area(path);
  if (!section || path.endsWith(".test.ts") || path.endsWith(".test.tsx"))
    continue;
  for (const match of source.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
    let key: string;
    try {
      key = JSON.parse(match[0]);
    } catch {
      continue;
    }
    if (!keys.has(key)) continue;
    if (!contexts.has(key)) contexts.set(key, new Set());
    contexts.get(key)!.add(section);
  }
}
export const areasForKey = (key: string): string[] =>
  Array.from(contexts.get(key) ?? ["Shared & messages"]);

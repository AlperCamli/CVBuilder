// Review tools are local by default; an explicit flag enables dedicated review builds.
export const DESIGN_TOOLS_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DESIGN_TOOLS === "true";

// Public CV creation starts with the upload-first onboarding flow.
export const CV_START_PATH = "/onboarding";

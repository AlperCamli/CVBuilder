import type { ComponentType, ReactNode } from "react";
import { DESIGN_TOOLS_ENABLED } from "../design-tools";
import type { ApiClient } from "./api-client";

/** A query parameter never changes normal application authentication. */
export function isStudioPreviewFrame() {
  if (
    !DESIGN_TOOLS_ENABLED ||
    typeof window === "undefined" ||
    window.parent === window
  )
    return false;
  const query = new URLSearchParams(window.location.search);
  return (
    query.get("languagePreview") === "1" &&
    /^[\w-]{8,80}$/.test(query.get("previewSession") ?? "")
  );
}

interface StudioRuntime {
  client: ApiClient;
  AuthProvider: ComponentType<{ children: ReactNode }>;
}
let runtime: StudioRuntime | null = null;
export function installStudioRuntime(value: StudioRuntime) {
  if (isStudioPreviewFrame()) runtime = value;
}
export function getStudioRuntime() {
  return DESIGN_TOOLS_ENABLED &&
    typeof window !== "undefined" &&
    window.parent !== window
    ? runtime
    : null;
}

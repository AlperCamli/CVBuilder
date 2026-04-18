import type { AuthenticatedRequestContext } from "../auth/auth.types";

export type SessionContext = AuthenticatedRequestContext;

export type TemplateResolution = "selected" | "default_active" | "none";

export interface TemplateSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  preview_config: Record<string, unknown> | null;
  export_config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateDetail {
  template: TemplateSummary;
}

export interface ListTemplatesResponse {
  templates: TemplateSummary[];
}

export interface ResolvedTemplateSummary {
  resolution: TemplateResolution;
  template: TemplateSummary | null;
}

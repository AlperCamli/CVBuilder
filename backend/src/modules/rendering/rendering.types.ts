import type { AuthenticatedRequestContext } from "../auth/auth.types";
import type {
  CvBlock,
  CvContent,
  CvJsonValue,
  CvSection,
  CvVisibility
} from "../../shared/cv-content/cv-content.types";
import type { ResolvedTemplateSummary } from "../templates/templates.types";
import type { RenderingPresentation } from "./rendering-presentation";

export type SessionContext = AuthenticatedRequestContext;

export type RenderCvKind = "master" | "tailored";

export interface RenderingDocumentMetadata {
  kind: RenderCvKind;
  id: string | null;
  title: string | null;
  language: string;
  generated_at: string;
  updated_at: string | null;
  context: Record<string, unknown>;
}

export interface RenderingFieldValue {
  raw: CvJsonValue;
  text: string;
  text_items: string[];
}

export interface RenderingBlockDerived {
  headline: string | null;
  subheadline: string | null;
  bullets: string[];
  date_range: string | null;
  location: string | null;
}

export interface RenderingBlock {
  id: string;
  type: string;
  order: number;
  visibility: CvVisibility;
  fields: Record<string, CvJsonValue>;
  meta: Record<string, CvJsonValue>;
  normalized_fields: Record<string, RenderingFieldValue>;
  derived: RenderingBlockDerived;
  plain_text: string;
}

export interface RenderingSection {
  id: string;
  type: string;
  title: string | null;
  order: number;
  meta: Record<string, CvJsonValue>;
  blocks: RenderingBlock[];
  plain_text: string;
}

export interface RenderingPayload {
  version: "v1";
  document: RenderingDocumentMetadata;
  template: ResolvedTemplateSummary;
  sections: RenderingSection[];
  plain_text: string;
}

export interface BuildRenderingInput {
  cv_kind: RenderCvKind;
  current_content: unknown;
  template_id?: string | null;
  language?: string;
  context?: Record<string, unknown>;
  document?: {
    id?: string | null;
    title?: string | null;
    updated_at?: string | null;
  };
  allow_inactive_selected_template?: boolean;
}

export interface BuildRenderingResult {
  current_content: CvContent;
  resolved_template: ResolvedTemplateSummary;
  rendering: RenderingPayload;
  presentation: RenderingPresentation;
}

export interface RenderingPreviewRequest {
  cv_kind: RenderCvKind;
  current_content: unknown;
  template_id?: string | null;
  language?: string;
  context?: Record<string, unknown>;
}

export interface RenderingPreviewResponse {
  current_content: CvContent;
  resolved_template: ResolvedTemplateSummary;
  rendering: RenderingPayload;
  presentation: RenderingPresentation;
}

export interface SectionRenderingContext {
  section: CvSection;
  blocks: RenderingBlock[];
}

export interface BlockRenderingContext {
  block: CvBlock;
  normalized_fields: Record<string, RenderingFieldValue>;
}

export type CvVisibility = "visible" | "hidden";

export type CvJsonPrimitive = string | number | boolean | null;
export type CvJsonValue = CvJsonPrimitive | CvJsonValue[] | { [key: string]: CvJsonValue };

export interface CvBlock {
  id: string;
  type: string;
  order: number;
  visibility: CvVisibility;
  fields: Record<string, CvJsonValue>;
  meta: Record<string, CvJsonValue>;
}

export interface CvSection {
  id: string;
  type: string;
  title: string | null;
  order: number;
  blocks: CvBlock[];
  meta: Record<string, CvJsonValue>;
}

export interface CvContent {
  version: "v1";
  language: string;
  metadata: Record<string, CvJsonValue>;
  sections: CvSection[];
}

export interface CvPreview {
  version: "v1";
  language: string;
  generated_at: string;
  plain_text: string;
  sections: CvSection[];
}

export interface CvBlockPatch {
  type?: string;
  order?: number;
  visibility?: CvVisibility;
  fields?: Record<string, CvJsonValue>;
  meta?: Record<string, CvJsonValue>;
  replace_fields?: boolean;
}

export interface CvBlockUpdateResult {
  content: CvContent;
  updated_block: CvBlock;
  section_id: string;
}

export interface CvBlockLookupResult {
  block: CvBlock;
  section_id: string;
}

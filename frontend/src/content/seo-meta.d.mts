// Type declarations for seo-meta.mjs (shared between Node scripts and the app).

export type BreadcrumbTrailItem = {
  name: string;
  path: string;
};

export type FaqItem = {
  question: string;
  answer: string;
};

export type SeoRoute = {
  path: string;
  snapshot: string;
  title: string;
  description: string;
  canonical: string;
  robots?: string;
  ogType?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage: string;
  ogImageAlt?: string;
  ogImageWidth?: number;
  ogImageHeight?: number;
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  twitterImageAlt?: string;
  lastmod: string;
  includeInSitemap: boolean;
  changefreq: string;
  priority: string;
  jsonLd: Record<string, unknown>[];
};

export declare const SITE_URL: string;
export declare const SITE_NAME: string;
export declare const OG_IMAGE: string;
export declare const DEFAULT_IMAGE_ALT: string;
export declare const ORGANIZATION_JSON_LD: Record<string, unknown>;
export declare const WEB_APPLICATION_JSON_LD: Record<string, unknown>;
export declare const LANDING_FAQ_ITEMS: FaqItem[];

export declare function absoluteUrl(path: string): string;
export declare function breadcrumbJsonLd(items: BreadcrumbTrailItem[]): Record<string, unknown>;
export declare function faqPageJsonLd(items: FaqItem[]): Record<string, unknown>;
export declare function categoryPath(category: { slug: string }): string;
export declare function articlePath(article: { categorySlug: string; slug: string }): string;
export declare function buildSeoRoutes(content: unknown): SeoRoute[];

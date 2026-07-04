import { useEffect } from "react";
import { useLocation } from "react-router";
import content from "../../content/career-advice-content.json";
import { buildSeoRoutes, type SeoRoute } from "../../content/seo-meta.mjs";

// Keeps <head> in sync during client-side navigation. The prerendered HTML
// already carries the correct tags for the initially loaded URL; this applies
// the same metadata (from the same source, seo-meta.mjs) when the user
// navigates within the SPA, and marks unknown URLs noindex.

type HeadMeta = {
  title: string;
  robots: string;
  description?: string;
  canonical?: string;
  ogType?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogUrl?: string;
  ogImage?: string;
  ogImageAlt?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  twitterImage?: string;
  twitterImageAlt?: string;
  jsonLd?: Record<string, unknown>[];
};

const SEO_ROUTES: Map<string, SeoRoute> = new Map(
  buildSeoRoutes(content).map((route) => [route.path, route])
);

const AUTH_PAGE_TITLES: Record<string, string> = {
  "/signin": "Sign in | jobspecificCV",
  "/signup": "Sign up | jobspecificCV",
  "/forgot-password": "Forgot password | jobspecificCV",
  "/reset-password": "Reset password | jobspecificCV",
  "/email-sent": "Check your email | jobspecificCV",
};

const NOT_FOUND_META: HeadMeta = {
  title: "Page not found | jobspecificCV",
  robots: "noindex, follow",
};

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path || "/";
}

function routeToHeadMeta(route: SeoRoute): HeadMeta {
  return {
    title: route.title,
    robots: route.robots || "index, follow",
    description: route.description,
    canonical: route.canonical,
    ogType: route.ogType || "website",
    ogTitle: route.ogTitle || route.title,
    ogDescription: route.ogDescription || route.description,
    ogUrl: route.canonical,
    ogImage: route.ogImage,
    ogImageAlt: route.ogImageAlt || route.ogTitle || route.title,
    twitterTitle: route.twitterTitle || route.title,
    twitterDescription: route.twitterDescription || route.description,
    twitterImage: route.twitterImage || route.ogImage,
    twitterImageAlt:
      route.twitterImageAlt || route.ogImageAlt || route.twitterTitle || route.title,
    jsonLd: route.jsonLd,
  };
}

export function getHeadMetaForPath(pathname: string): HeadMeta | null {
  const path = normalizePath(pathname);

  const route = SEO_ROUTES.get(path);
  if (route) {
    return routeToHeadMeta(route);
  }

  if (AUTH_PAGE_TITLES[path]) {
    return { title: AUTH_PAGE_TITLES[path], robots: "noindex, nofollow" };
  }

  if (path === "/medical" || path.startsWith("/app") || path.startsWith("/auth")) {
    return { title: "jobspecificCV", robots: "noindex, nofollow" };
  }

  return NOT_FOUND_META;
}

function upsertMeta(attribute: "name" | "property", key: string, value: string | undefined) {
  if (value === undefined) {
    return;
  }
  let tag = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!tag) {
    tag = document.createElement("meta");
    tag.setAttribute(attribute, key);
    document.head.appendChild(tag);
  }
  tag.setAttribute("content", value);
}

function applyHeadMeta(meta: HeadMeta) {
  document.title = meta.title;

  upsertMeta("name", "robots", meta.robots);
  upsertMeta("name", "description", meta.description);
  upsertMeta("property", "og:type", meta.ogType);
  upsertMeta("property", "og:title", meta.ogTitle);
  upsertMeta("property", "og:description", meta.ogDescription);
  upsertMeta("property", "og:url", meta.ogUrl);
  upsertMeta("property", "og:image", meta.ogImage);
  upsertMeta("property", "og:image:alt", meta.ogImageAlt);
  upsertMeta("name", "twitter:title", meta.twitterTitle);
  upsertMeta("name", "twitter:description", meta.twitterDescription);
  upsertMeta("name", "twitter:image", meta.twitterImage);
  upsertMeta("name", "twitter:image:alt", meta.twitterImageAlt);

  const canonicalTag = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (meta.canonical) {
    if (canonicalTag) {
      canonicalTag.setAttribute("href", meta.canonical);
    } else {
      const link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      link.setAttribute("href", meta.canonical);
      document.head.appendChild(link);
    }
  } else if (canonicalTag) {
    canonicalTag.remove();
  }

  document.head
    .querySelectorAll('script[data-route-json-ld="true"]')
    .forEach((script) => script.remove());
  (meta.jsonLd || []).forEach((entry) => {
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.dataset.routeJsonLd = "true";
    script.textContent = JSON.stringify(entry).replaceAll("<", "\\u003c");
    document.head.appendChild(script);
  });
}

export function RouteSeo() {
  const { pathname } = useLocation();

  useEffect(() => {
    const meta = getHeadMetaForPath(pathname);
    if (meta) {
      applyHeadMeta(meta);
    }
  }, [pathname]);

  return null;
}

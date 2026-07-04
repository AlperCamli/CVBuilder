import { readFileSync } from "node:fs";
import { buildSeoRoutes, SITE_URL } from "../src/content/seo-meta.mjs";

const content = JSON.parse(
  readFileSync(new URL("../src/content/career-advice-content.json", import.meta.url), "utf8")
);

// Reads width/height from a PNG's IHDR chunk so og:image:width/height match
// the actual file (hero covers ship in more than one size).
function pngDimensions(publicPath) {
  try {
    const buf = readFileSync(new URL(`../public${publicPath}`, import.meta.url));
    // 8-byte signature, then IHDR: length(4) + "IHDR"(4) + width(4) + height(4)
    if (buf.length > 24 && buf.toString("ascii", 12, 16) === "IHDR") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
  } catch {
    // fall through — keep the default og:image dimensions from index.html
  }
  return null;
}

function withOgImageDimensions(route) {
  if (typeof route.ogImage !== "string" || !route.ogImage.endsWith(".png")) {
    return route;
  }
  if (!route.ogImage.startsWith(SITE_URL)) {
    return route;
  }
  const dims = pngDimensions(route.ogImage.slice(SITE_URL.length));
  if (!dims) {
    return route;
  }
  return { ...route, ogImageWidth: dims.width, ogImageHeight: dims.height };
}

// Routes to prerender. Route metadata lives in src/content/seo-meta.mjs so the
// client-side head manager (src/app/seo/route-seo.tsx) uses the same source.
export const ROUTES = buildSeoRoutes(content).map(withOgImageDimensions);

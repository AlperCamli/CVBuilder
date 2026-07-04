import { writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROUTES } from "./routes.mjs";

// Generates dist/sitemap.xml from ROUTES so the sitemap can never drift from
// the prerendered pages (it previously lived as a hand-edited file in public/).

export function sitemapXml(routes) {
  const entries = routes
    .filter((route) => route.includeInSitemap)
    .map(
      (route) => `  <url>
    <loc>${route.canonical}</loc>
    <lastmod>${route.lastmod}</lastmod>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

export async function writeSitemap(distDir) {
  const target = join(distDir, "sitemap.xml");
  await writeFile(target, sitemapXml(ROUTES), "utf8");
  return target;
}

const isDirectRun =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const distDir = join(resolve(__dirname, ".."), "dist");
  const target = await writeSitemap(distDir);
  console.log(`✓ Wrote ${target}`);
}

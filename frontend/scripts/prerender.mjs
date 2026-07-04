import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import { ROUTES } from "./routes.mjs";
import { injectRouteMetadata, buildSpaFallbackHtml } from "./seo-html.mjs";
import { writeSitemap } from "./generate-sitemap.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(__dirname, "..");
const DIST_DIR = join(FRONTEND_DIR, "dist");
const SSR_ENTRY = join(FRONTEND_DIR, "dist-ssr", "entry-server.js");
const PRERENDERED_DIR = join(FRONTEND_DIR, "prerendered");

function injectIntoHtml(html, innerHTML, route) {
  // Replace the empty (or previously-injected) #root with the new content.
  const rootOpenRe = /<div\s+id="root"[^>]*>[\s\S]*?<\/div>/;
  if (!rootOpenRe.test(html)) {
    throw new Error('Could not find <div id="root">...</div> in index.html');
  }
  return html.replace(
    rootOpenRe,
    `<div id="root" data-prerender-path="${route.path}">${innerHTML}</div>`
  );
}

async function main() {
  if (!existsSync(DIST_DIR)) {
    throw new Error(`dist/ not found at ${DIST_DIR}. Run "vite build" first.`);
  }

  if (!existsSync(SSR_ENTRY)) {
    throw new Error(`SSR entry not found at ${SSR_ENTRY}. Run "vite build --ssr" first.`);
  }

  await mkdir(PRERENDERED_DIR, { recursive: true });

  console.log("▶ Loading server renderer");
  const { renderRoute } = await import(pathToFileURL(SSR_ENTRY).href);

  const distIndexPath = join(DIST_DIR, "index.html");
  const baseHtml = await readFile(distIndexPath, "utf8");

  for (const route of ROUTES) {
    console.log(`▶ Prerendering ${route.path}`);
    const innerHTML = renderRoute(route.path);
    const size = Buffer.byteLength(innerHTML, "utf8");
    console.log(`  rendered ${size.toLocaleString()} bytes`);

    if (size < 1000) {
      throw new Error(
        `Snapshot for ${route.path} is suspiciously small (${size} bytes). Aborting.`
      );
    }

    const snapshotPath = join(PRERENDERED_DIR, `${route.snapshot}.html`);
    await writeFile(snapshotPath, innerHTML, "utf8");
    console.log(`  wrote ${snapshotPath}`);

    // Also patch dist/index.html so `vite preview` shows the prerendered output.
    // For non-root paths, write to dist/<path>/index.html.
    const distTargetDir =
      route.path === "/" ? DIST_DIR : join(DIST_DIR, route.path);
    await mkdir(distTargetDir, { recursive: true });
    const distTarget = join(distTargetDir, "index.html");
    const patched = injectRouteMetadata(injectIntoHtml(baseHtml, innerHTML, route), route);
    await writeFile(distTarget, patched, "utf8");
    console.log(`  patched ${distTarget}`);

    if (route.path !== "/") {
      const cleanUrlTarget = join(DIST_DIR, `${route.path.slice(1)}.html`);
      await mkdir(dirname(cleanUrlTarget), { recursive: true });
      await writeFile(cleanUrlTarget, patched, "utf8");
      console.log(`  patched ${cleanUrlTarget}`);
    }
  }

  const fallbackTarget = join(DIST_DIR, "spa-fallback.html");
  await writeFile(fallbackTarget, buildSpaFallbackHtml(baseHtml), "utf8");
  console.log(`✓ Wrote ${fallbackTarget}`);

  const sitemapTarget = await writeSitemap(DIST_DIR);
  console.log(`✓ Wrote ${sitemapTarget}`);

  console.log("✓ Prerender complete");
}

main().catch((err) => {
  console.error("✗ Prerender failed:", err);
  process.exit(1);
});

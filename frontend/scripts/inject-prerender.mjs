import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ROUTES } from "./routes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(__dirname, "..");
const DIST_DIR = join(FRONTEND_DIR, "dist");
const PRERENDERED_DIR = join(FRONTEND_DIR, "prerendered");

function injectIntoHtml(html, innerHTML) {
  const rootRe = /<div\s+id="root"[^>]*>[\s\S]*?<\/div>/;
  if (!rootRe.test(html)) {
    throw new Error('Could not find <div id="root">...</div> in index.html');
  }
  return html.replace(rootRe, `<div id="root">${innerHTML}</div>`);
}

async function main() {
  if (!existsSync(DIST_DIR)) {
    throw new Error(`dist/ not found at ${DIST_DIR}. Run "vite build" first.`);
  }

  const distIndexPath = join(DIST_DIR, "index.html");
  const baseHtml = await readFile(distIndexPath, "utf8");

  for (const route of ROUTES) {
    const snapshotPath = join(PRERENDERED_DIR, `${route.snapshot}.html`);
    if (!existsSync(snapshotPath)) {
      throw new Error(
        `Missing prerendered snapshot for ${route.path} at ${snapshotPath}. ` +
        `Run "npm run build" locally to regenerate.`
      );
    }

    const innerHTML = await readFile(snapshotPath, "utf8");
    const size = Buffer.byteLength(innerHTML, "utf8");
    if (size < 1000) {
      throw new Error(
        `Snapshot ${snapshotPath} is suspiciously small (${size} bytes). ` +
        `Regenerate it locally with "npm run build".`
      );
    }

    const patched = injectIntoHtml(baseHtml, innerHTML);

    const targetDir =
      route.path === "/" ? DIST_DIR : join(DIST_DIR, route.path);
    await mkdir(targetDir, { recursive: true });
    const target = join(targetDir, "index.html");
    await writeFile(target, patched, "utf8");
    console.log(`✓ Injected ${route.snapshot}.html → ${target} (${size.toLocaleString()} bytes)`);
  }
}

main().catch((err) => {
  console.error("✗ Inject failed:", err);
  process.exit(1);
});

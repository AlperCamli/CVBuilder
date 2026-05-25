import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { ROUTES } from "./routes.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = resolve(__dirname, "..");
const DIST_DIR = join(FRONTEND_DIR, "dist");
const PRERENDERED_DIR = join(FRONTEND_DIR, "prerendered");
const PORT = 4321;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

function startStaticServer(root) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";

      let filePath = join(root, pathname);
      if (!filePath.startsWith(root)) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }

      if (!existsSync(filePath)) {
        // SPA fallback for client-side routes
        filePath = join(root, "index.html");
      }

      const body = await readFile(filePath);
      const type = MIME[extname(filePath)] || "application/octet-stream";
      res.setHeader("Content-Type", type);
      res.statusCode = 200;
      res.end(body);
    } catch (err) {
      res.statusCode = 500;
      res.end(`Server error: ${err.message}`);
    }
  });

  return new Promise((resolveStart) => {
    server.listen(PORT, () => resolveStart(server));
  });
}

async function prerenderRoute(browser, route) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  const url = `http://localhost:${PORT}${route.path}`;
  await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });

  // Wait for React to actually mount content into #root
  await page.waitForFunction(
    () => {
      const root = document.getElementById("root");
      return root && root.children.length > 0 && root.innerHTML.length > 500;
    },
    { timeout: 15_000 }
  );

  const innerHTML = await page.evaluate(
    () => document.getElementById("root").innerHTML
  );

  await page.close();

  if (errors.length) {
    console.warn(`⚠ Page errors on ${route.path}:`);
    errors.forEach((e) => console.warn(`  - ${e}`));
  }

  // Strip <video> tags from the snapshot. Crawlers don't index video bytes
  // for text SEO, but leaving these in causes the browser to start fetching
  // 5 videos before the JS bundle arrives — bandwidth competition + jank
  // when React later wipes/remounts the same DOM. The parent gradient
  // placeholder remains, so layout is preserved until React mounts.
  return innerHTML.replace(/<video\b[^>]*>[\s\S]*?<\/video>/gi, "");
}

function injectIntoHtml(html, innerHTML) {
  // Replace the empty (or previously-injected) #root with the new content.
  const rootOpenRe = /<div\s+id="root"[^>]*>[\s\S]*?<\/div>/;
  if (!rootOpenRe.test(html)) {
    throw new Error('Could not find <div id="root">...</div> in index.html');
  }
  return html.replace(rootOpenRe, `<div id="root">${innerHTML}</div>`);
}

async function main() {
  if (!existsSync(DIST_DIR)) {
    throw new Error(`dist/ not found at ${DIST_DIR}. Run "vite build" first.`);
  }

  await mkdir(PRERENDERED_DIR, { recursive: true });

  console.log(`▶ Starting static server on http://localhost:${PORT}`);
  const server = await startStaticServer(DIST_DIR);

  console.log("▶ Launching headless Chrome");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const distIndexPath = join(DIST_DIR, "index.html");
    const baseHtml = await readFile(distIndexPath, "utf8");

    for (const route of ROUTES) {
      console.log(`▶ Prerendering ${route.path}`);
      const innerHTML = await prerenderRoute(browser, route);
      const size = Buffer.byteLength(innerHTML, "utf8");
      console.log(`  captured ${size.toLocaleString()} bytes`);

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
      const patched = injectIntoHtml(baseHtml, innerHTML);
      await writeFile(distTarget, patched, "utf8");
      console.log(`  patched ${distTarget}`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log("✓ Prerender complete");
}

main().catch((err) => {
  console.error("✗ Prerender failed:", err);
  process.exit(1);
});

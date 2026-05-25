# Local Prerender — How and When

The homepage (`/`) is prerendered to static HTML so search engines see real content. The prerender runs **locally only** (Vercel's build environment can't launch Chromium). The committed snapshot in `frontend/prerendered/landing.html` is what Vercel injects into the live site.

## When to re-run the prerender

Re-run **every time you change anything that affects the visual output of [Landing.tsx](../../frontend/src/app/pages/Landing.tsx)** — text, layout, components imported by Landing, global styles, etc.

If you forget, Vercel will deploy the **previous** snapshot — the site still works, but search engines see stale content.

## How to run it

```bash
cd frontend
npm run build
```

This does two things:

1. `vite build` → produces `dist/`
2. `scripts/prerender.mjs` → launches headless Chrome, renders `/`, writes:
   - `frontend/prerendered/landing.html` ← **commit this**
   - `frontend/dist/index.html` (for local `vite preview` testing only)

## Commit and push

```bash
git add frontend/prerendered/landing.html
git commit -m "chore: refresh landing prerender"
git push
```

Vercel then runs `vercel-build` (defined in [package.json](../../frontend/package.json)) which is just `vite build` + [inject-prerender.mjs](../../frontend/scripts/inject-prerender.mjs) — no Chromium, fast, reliable.

## How to verify it worked

After running `npm run build`, the snapshot should be substantial (~14KB+ for the current Landing page):

```bash
wc -c frontend/prerendered/landing.html
```

If it's tiny (<1KB), something failed — check the prerender output for errors.

## Why this setup

| Approach | Why we did/didn't pick it |
|---|---|
| Puppeteer on Vercel build | ❌ Vercel build env lacks `libnss3` and other Chromium libs |
| `@sparticuz/chromium` | ❌ Designed for Lambda runtime, not Vercel build step (same lib issue) |
| Full SSR with `renderToString` | ⏸ Cleaner long-term, but requires refactoring AuthProvider + entry points |
| **Local prerender + commit + Vercel inject** ✅ | Works now, zero runtime dependencies, only manual step is remembering to re-run on Landing changes |

## Adding more prerendered routes later

If you ever need to prerender additional public pages (e.g., a future `/about` or `/blog`), update the `ROUTES` array in **both**:

- [frontend/scripts/prerender.mjs](../../frontend/scripts/prerender.mjs)
- [frontend/scripts/inject-prerender.mjs](../../frontend/scripts/inject-prerender.mjs)

Use the same `{ path, snapshot }` shape. The `snapshot` value is the filename (without `.html`) inside `frontend/prerendered/`.

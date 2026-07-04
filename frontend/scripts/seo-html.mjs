function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}

function replaceTag(html, pattern, replacement) {
  if (!pattern.test(html)) {
    throw new Error(`Could not find SEO tag matching ${pattern}`);
  }
  return html.replace(pattern, replacement);
}

function routeJsonLdScripts(route) {
  if (!Array.isArray(route.jsonLd) || route.jsonLd.length === 0) return "";

  return route.jsonLd
    .map((entry) => {
      const json = JSON.stringify(entry, null, 2).replaceAll("<", "\\u003c");
      return `<script type="application/ld+json" data-route-json-ld="true">\n${json}\n    </script>`;
    })
    .join("\n    ");
}

export function injectRouteMetadata(html, route) {
  let next = html.replace(
    /\s*<script type="application\/ld\+json" data-route-json-ld="true">[\s\S]*?<\/script>/g,
    ""
  );

  next = replaceTag(
    next,
    /<title>[\s\S]*?<\/title>/,
    `<title>${escapeHtml(route.title)}</title>`
  );
  next = replaceTag(
    next,
    /<meta\s+name="robots"\s+content="[^"]*"\s*\/>/,
    `<meta name="robots" content="${escapeAttribute(route.robots || "index, follow")}" />`
  );
  next = replaceTag(
    next,
    /<meta\s+name="description"\s+content="[^"]*"\s*\/>/,
    `<meta name="description" content="${escapeAttribute(route.description)}" />`
  );
  next = replaceTag(
    next,
    /<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/,
    `<link rel="canonical" href="${escapeAttribute(route.canonical)}" />`
  );
  next = replaceTag(
    next,
    /<meta\s+property="og:type"\s+content="[^"]*"\s*\/>/,
    `<meta property="og:type" content="${escapeAttribute(route.ogType || "website")}" />`
  );
  next = replaceTag(
    next,
    /<meta\s+property="og:title"\s+content="[^"]*"\s*\/>/,
    `<meta property="og:title" content="${escapeAttribute(route.ogTitle || route.title)}" />`
  );
  next = replaceTag(
    next,
    /<meta\s+property="og:description"\s+content="[^"]*"\s*\/>/,
    `<meta property="og:description" content="${escapeAttribute(route.ogDescription || route.description)}" />`
  );
  next = replaceTag(
    next,
    /<meta\s+property="og:url"\s+content="[^"]*"\s*\/>/,
    `<meta property="og:url" content="${escapeAttribute(route.canonical)}" />`
  );
  next = replaceTag(
    next,
    /<meta\s+property="og:image"\s+content="[^"]*"\s*\/>/,
    `<meta property="og:image" content="${escapeAttribute(route.ogImage)}" />`
  );
  if (route.ogImageWidth && route.ogImageHeight) {
    next = replaceTag(
      next,
      /<meta\s+property="og:image:width"\s+content="[^"]*"\s*\/>/,
      `<meta property="og:image:width" content="${escapeAttribute(route.ogImageWidth)}" />`
    );
    next = replaceTag(
      next,
      /<meta\s+property="og:image:height"\s+content="[^"]*"\s*\/>/,
      `<meta property="og:image:height" content="${escapeAttribute(route.ogImageHeight)}" />`
    );
  }
  next = replaceTag(
    next,
    /<meta\s+property="og:image:alt"\s+content="[^"]*"\s*\/>/,
    `<meta property="og:image:alt" content="${escapeAttribute(route.ogImageAlt || route.ogTitle || route.title)}" />`
  );
  next = replaceTag(
    next,
    /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/>/,
    `<meta name="twitter:title" content="${escapeAttribute(route.twitterTitle || route.title)}" />`
  );
  next = replaceTag(
    next,
    /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/>/,
    `<meta name="twitter:description" content="${escapeAttribute(route.twitterDescription || route.description)}" />`
  );
  next = replaceTag(
    next,
    /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/>/,
    `<meta name="twitter:image" content="${escapeAttribute(route.twitterImage || route.ogImage)}" />`
  );
  next = replaceTag(
    next,
    /<meta\s+name="twitter:image:alt"\s+content="[^"]*"\s*\/>/,
    `<meta name="twitter:image:alt" content="${escapeAttribute(route.twitterImageAlt || route.ogImageAlt || route.twitterTitle || route.title)}" />`
  );

  const scripts = routeJsonLdScripts(route);
  if (scripts) {
    next = next.replace("</head>", `    ${scripts}\n  </head>`);
  }

  return next;
}

// The shell served for URLs with no prerendered file: private app/auth routes
// (already noindexed via headers) and unknown URLs (client renders the 404
// page). noindex + no canonical keeps these from registering as soft-404
// duplicates of the landing page.
export function buildSpaFallbackHtml(html) {
  let next = html.replace(
    /\s*<script type="application\/ld\+json" data-route-json-ld="true">[\s\S]*?<\/script>/g,
    ""
  );

  next = replaceTag(next, /<title>[\s\S]*?<\/title>/, "<title>jobspecificCV</title>");
  next = replaceTag(
    next,
    /<meta\s+name="robots"\s+content="[^"]*"\s*\/>/,
    '<meta name="robots" content="noindex" />'
  );
  next = next.replace(/\s*<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/, "");

  return next;
}

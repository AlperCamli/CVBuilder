/** Collect CSS for a lazy route, including shared imported chunks, from Vite's manifest. */
export function injectRouteAssets(html, route, manifest) {
  if (!route.clientEntry) return html;
  const visited = new Set();
  const styles = new Set();
  function visit(key) {
    if (visited.has(key)) return;
    visited.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Missing build manifest entry: ${key}`);
    for (const dependency of chunk.imports ?? []) visit(dependency);
    for (const css of chunk.css ?? []) styles.add(css);
  }
  visit(route.clientEntry);
  const links = [...styles]
    .filter((file) => !html.includes(`href="/${file}"`))
    .map((file) => `<link rel="stylesheet" crossorigin href="/${file}" />`);
  const entry = manifest[route.clientEntry];
  links.push(`<link rel="modulepreload" crossorigin href="/${entry.file}" />`);
  return html.replace("</head>", `${links.join("\n")}\n</head>`);
}

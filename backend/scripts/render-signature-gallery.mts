import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import profiles from "../src/modules/rendering/signature-template-profiles.ts";
const { SIGNATURE_TEMPLATES } = profiles;

const output = resolve(process.argv[2] ?? "../artifacts/cv-templates");
const cards: string[] = [];
for (const template of SIGNATURE_TEMPLATES) {
  const file = template.name.toLowerCase().replaceAll(" ", "-");
  const doc = await getDocument({ data: new Uint8Array(await readFile(resolve(output, `${file}.pdf`))), useSystemFonts: false }).promise;
  const page = await doc.getPage(1);
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = createCanvas(viewport.width, viewport.height);
  await page.render({ canvas: canvas as never, canvasContext: canvas.getContext("2d") as never, viewport }).promise;
  await writeFile(resolve(output, `${file}.png`), canvas.toBuffer("image/png"));
  cards.push(`<article data-family="${template.layout}"><a href="${file}.pdf"><img src="${file}.png" loading="lazy" width="595" height="842" alt="${template.name} CV preview"></a><div class="caption"><div><h2>${template.name}</h2><p>${template.paletteName} · ${doc.numPages} ${doc.numPages === 1 ? "page" : "pages"}</p></div><a class="download" href="${file}.pdf" download>Download PDF</a></div></article>`);
  console.log(`${template.name}: ${doc.numPages} pages`);
  await doc.destroy();
}
const tabs = SIGNATURE_TEMPLATES.filter(t => t.isBase).map(t => `<button type="button" data-filter="${t.layout}">${t.name}</button>`).join("");
await writeFile(resolve(output, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>JobSpecificCV · Signature collection</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f4f5f7;color:#192c38;font:15px system-ui,sans-serif}header,main{max-width:1240px;margin:auto;padding:32px}header{padding-bottom:16px}h1{font-size:36px;letter-spacing:-1px;margin:8px 0}p{color:#526071;line-height:1.6}nav{display:flex;gap:8px;flex-wrap:wrap;margin-top:24px}button,.download{border:1px solid #ccd4db;border-radius:6px;padding:10px 14px;background:white;color:#192c38;cursor:pointer;text-decoration:none}button[aria-pressed=true]{background:#123d3a;color:white;border-color:#123d3a}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}article{background:white;border:1px solid #dbe0e5;border-radius:8px;overflow:hidden}article[hidden]{display:none}img{width:100%;height:auto;display:block}img:hover{opacity:.96}.caption{border-top:1px solid #edf0f3;padding:16px;display:flex;align-items:center;justify-content:space-between;gap:12px}h2{font-size:16px;margin:0}.caption p{margin:4px 0 0;font-size:12px;text-transform:capitalize}.download{font-size:12px;white-space:nowrap}@media(max-width:900px){main{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){main{grid-template-columns:1fr}header,main{padding:20px}}</style></head>
<body><header><p>JOBSPECIFICCV / SIGNATURE COLLECTION</p><h1>Six layouts. Eighteen ways to make an impression.</h1><p>Compare the same sample CV across every layout and palette, then open or download the PDF.</p><nav aria-label="Filter templates"><button type="button" data-filter="all" aria-pressed="true">All 18 templates</button>${tabs}</nav></header><main>${cards.join("\n")}</main>
<script>document.querySelectorAll('[data-filter]').forEach(button=>{button.addEventListener('click',()=>{document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));document.querySelectorAll('[data-family]').forEach(card=>{card.hidden=button.dataset.filter!=='all'&&card.dataset.family!==button.dataset.filter;});});});</script></body></html>`);

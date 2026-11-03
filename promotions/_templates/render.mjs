#!/usr/bin/env node
// Renders a promotion email from promotions/<slug>/copy.<locale>.json into
//   promotions/<slug>/email/email.<locale>.html, email.<locale>.txt and email/manifest.json.
//
// Usage (from the repo root or anywhere):
//   node promotions/_templates/render.mjs <slug>
//   node promotions/_templates/render.mjs <slug> --preview <dir>   # also writes filled-in previews (local image) to <dir>
//
// No dependencies. Template syntax (offer-email.html):
//   [[key]]                 copy value, HTML-escaped
//   [[#key]] … [[/key]]     repeat for each item of an array (fields as [[.field]]), or render once if the
//                           value is a non-empty string / true, or drop the block if empty/false/missing
//   {{placeholder}}         per-recipient placeholder, left untouched for the email agent:
//                           {{first_name}} {{offer_url}} {{unsubscribe_url}} {{ends_at_display}}
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROMOS = resolve(HERE, "..");
const REPO = resolve(PROMOS, "..");
const PLACEHOLDERS = ["first_name", "offer_url", "unsubscribe_url", "ends_at_display"];
const REQUIRED = [
  "locale", "lang", "subject", "preheader", "brand_name", "wordmark", "site_url", "logo_url",
  "image_url", "image_alt", "image_width", "image_height", "eyebrow", "headline", "lead",
  "greeting_with_name", "greeting_fallback", "intro", "cta", "urgency", "benefits_title", "benefits",
  "terms", "signoff", "footer_reason", "unsubscribe_prefix", "unsubscribe_label", "ends_at_display"
];
const SUBJECT_MAX = 45;

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--"));
const previewIdx = args.indexOf("--preview");
const previewDir = previewIdx >= 0 ? resolve(args[previewIdx + 1] ?? "") : null;
if (!slug || (previewIdx >= 0 && !args[previewIdx + 1])) {
  console.error("Usage: node promotions/_templates/render.mjs <slug> [--preview <dir>]");
  process.exit(1);
}

const campaignDir = join(PROMOS, slug);
const campaignPath = join(campaignDir, "campaign.json");
const campaign = existsSync(campaignPath) ? JSON.parse(readFileSync(campaignPath, "utf8")) : null;
const template = readFileSync(join(HERE, "offer-email.html"), "utf8");
const locales = readdirSync(campaignDir)
  .map((f) => /^copy\.([a-z]{2})\.json$/.exec(f)?.[1])
  .filter(Boolean)
  .sort();
if (!locales.length) fail(`no copy.<locale>.json files in ${campaignDir}`);

const errors = [];
const warnings = [];
function fail(msg) { console.error(`render: ${msg}`); process.exit(1); }

const escapeHtml = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Renders [[#block]]…[[/block]] sections, then [[key]] / [[.field]] values. */
function renderTemplate(tpl, data, where) {
  const withBlocks = tpl.replace(/\[\[#([a-z0-9_]+)\]\]\n?([\s\S]*?)\[\[\/\1\]\]\n?/g, (_, key, inner) => {
    const value = data[key];
    if (Array.isArray(value)) {
      return value.map((item, i) => inner.replace(/\[\[\.([a-z0-9_]+)\]\]/g, (m, field) => {
        if (item?.[field] == null || item[field] === "") errors.push(`${where}: ${key}[${i}].${field} is missing`);
        return escapeHtml(item?.[field] ?? "");
      })).join("");
    }
    return value ? inner : "";
  });
  return withBlocks.replace(/\[\[([a-z0-9_]+)\]\]/g, (m, key) => {
    if (data[key] == null || typeof data[key] === "object") { errors.push(`${where}: [[${key}]] has no string value`); return ""; }
    return escapeHtml(data[key]);
  });
}

function renderText(c) {
  const lines = [];
  const wrap = (s, width = 72, indent = "") => {
    const out = []; let line = "";
    for (const word of String(s).split(/\s+/)) {
      if (line && (line + " " + word).length > width) { out.push(line); line = indent + word; } else line = line ? `${line} ${word}` : word;
    }
    if (line) out.push(line);
    return out.join("\n");
  };
  lines.push(c.wordmark, "", c.eyebrow, c.headline, "", wrap(c.lead), "", c.greeting_with_name, "", wrap(c.intro), "");
  lines.push(`${c.cta}:`, "{{offer_url}}", "", wrap(c.urgency), "", c.benefits_title);
  for (const b of c.benefits) lines.push(wrap(`- ${b.title}: ${b.text}`, 72, "  "));
  lines.push("", wrap(c.terms), "", c.signoff, "", "--", wrap(c.footer_reason));
  lines.push(`${c.unsubscribe_prefix} ${c.unsubscribe_label}: {{unsubscribe_url}}`);
  if (c.footer_address) lines.push(c.footer_address);
  lines.push(`${c.brand_name} · ${c.site_url}`, "");
  return lines.join("\n");
}

/** Checks that each cohort's ends_at_display matches campaign.json (day of month and HH:MM in Istanbul time). */
function checkDeadlines(c, where) {
  if (!campaign?.cohorts) { warnings.push(`${where}: no campaign.json cohorts to check ends_at_display against`); return; }
  for (const cohort of campaign.cohorts) {
    const display = c.ends_at_display?.[cohort.key];
    if (!display) { errors.push(`${where}: ends_at_display.${cohort.key} is missing`); continue; }
    const end = new Date(cohort.ends_at);
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
    }).formatToParts(end).map((p) => [p.type, p.value]));
    const hhmm = `${parts.hour}:${parts.minute}`;
    const weekday = new Intl.DateTimeFormat(c.lang, { timeZone: "Europe/Istanbul", weekday: "long" }).format(end);
    if (!display.includes(hhmm)) errors.push(`${where}: ends_at_display.${cohort.key} should show ${hhmm} (Istanbul) for ${cohort.ends_at}`);
    if (!new RegExp(`\\b${parts.day}\\b`).test(display)) errors.push(`${where}: ends_at_display.${cohort.key} should show day ${parts.day}`);
    if (!display.toLocaleLowerCase(c.lang).includes(weekday.toLocaleLowerCase(c.lang))) {
      errors.push(`${where}: ends_at_display.${cohort.key} should name the weekday "${weekday}"`);
    }
  }
  for (const key of Object.keys(c.ends_at_display ?? {})) {
    if (campaign?.cohorts && !campaign.cohorts.some((k) => k.key === key)) warnings.push(`${where}: ends_at_display.${key} is not a cohort in campaign.json`);
  }
}

function leftoverPlaceholders(s) {
  return [...new Set([...s.matchAll(/\{\{\s*([a-z0-9_]+)\s*\}\}/g)].map((m) => m[1]))];
}

const outDir = join(campaignDir, "email");
mkdirSync(outDir, { recursive: true });
const manifest = {
  promotion_slug: slug,
  generated_by: "promotions/_templates/render.mjs",
  placeholders: PLACEHOLDERS.map((p) => `{{${p}}}`),
  locales: {}
};
const outputs = [];

for (const locale of locales) {
  const where = `copy.${locale}.json`;
  const c = JSON.parse(readFileSync(join(campaignDir, `copy.${locale}.json`), "utf8"));
  for (const key of REQUIRED) if (c[key] == null || c[key] === "") errors.push(`${where}: "${key}" is required`);
  if (c.locale !== locale) errors.push(`${where}: "locale" must be "${locale}"`);
  if ([...String(c.subject)].length > SUBJECT_MAX) errors.push(`${where}: subject is ${[...c.subject].length} chars (max ${SUBJECT_MAX})`);
  const emoji = (String(c.subject).match(/\p{Extended_Pictographic}/gu) ?? []).length;
  if (emoji > 1) errors.push(`${where}: subject has ${emoji} emoji (max 1)`);
  if (/\b[A-ZÇĞİÖŞÜ]{4,}\b/u.test(c.subject)) warnings.push(`${where}: subject contains an ALL-CAPS word`);
  if (!String(c.greeting_with_name).includes("{{first_name}}")) errors.push(`${where}: greeting_with_name must contain {{first_name}}`);
  if (String(c.greeting_fallback).includes("{{")) errors.push(`${where}: greeting_fallback must not contain placeholders`);
  if (!/^https:\/\//.test(c.image_url ?? "")) errors.push(`${where}: image_url must be an absolute https URL`);
  if (!Array.isArray(c.benefits) || c.benefits.length < 2 || c.benefits.length > 4) errors.push(`${where}: benefits must have 2–4 items`);
  checkDeadlines(c, where);

  const data = { ...c, site_host: String(c.site_url ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "") };
  const html = renderTemplate(template, data, where);
  const text = renderText(c);

  for (const [name, body] of [["html", html], ["txt", text]]) {
    const unknown = leftoverPlaceholders(body).filter((p) => !PLACEHOLDERS.includes(p));
    if (unknown.length) errors.push(`email.${locale}.${name}: unknown placeholders ${unknown.join(", ")}`);
    if (/\[\[[^\]]*\]\]/.test(body)) errors.push(`email.${locale}.${name}: unrendered [[…]] tags left`);
    const greeting = name === "html" ? escapeHtml(c.greeting_with_name) : c.greeting_with_name;
    const count = body.split(greeting).length - 1;
    if (count !== 1) errors.push(`email.${locale}.${name}: greeting "${greeting}" must appear exactly once (found ${count})`);
  }

  manifest.locales[locale] = {
    html: `email.${locale}.html`,
    txt: `email.${locale}.txt`,
    subject: c.subject,
    preheader: c.preheader,
    greeting_with_name: c.greeting_with_name,
    greeting_fallback: c.greeting_fallback,
    ends_at_display: c.ends_at_display,
    image_url: c.image_url
  };
  outputs.push({ locale, c, html, text });
}

for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) { for (const e of errors) console.error(`error: ${e}`); process.exit(1); }

for (const { locale, html, text } of outputs) {
  writeFileSync(join(outDir, `email.${locale}.html`), html);
  writeFileSync(join(outDir, `email.${locale}.txt`), text);
  console.log(`wrote ${slug}/email/email.${locale}.html (${Buffer.byteLength(html)} bytes) and email.${locale}.txt`);
}
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${slug}/email/manifest.json`);

// Previews: placeholders filled with sample values, image pointed at the local file. Never inside the repo.
if (previewDir) {
  if (previewDir.startsWith(REPO + "/") || previewDir === REPO) fail("--preview must point outside the repository");
  mkdirSync(previewDir, { recursive: true });
  const sample = { en: "Sam", tr: "Ayşe" };
  for (const { locale, c, html, text } of outputs) {
    const localImage = join(REPO, "frontend/public", new URL(c.image_url).pathname);
    const imageCopy = join(previewDir, new URL(c.image_url).pathname.split("/").pop());
    if (existsSync(localImage)) copyFileSync(localImage, imageCopy);
    const logoLocal = join(REPO, "frontend/public", new URL(c.logo_url).pathname);
    const logoCopy = join(previewDir, "logo.png");
    if (existsSync(logoLocal)) copyFileSync(logoLocal, logoCopy);
    for (const cohort of Object.keys(c.ends_at_display)) {
      for (const withName of [true, false]) {
        const fill = (body, isHtml) => {
          const esc = isHtml ? escapeHtml : (s) => s;
          let out = body;
          if (!withName) out = out.split(esc(c.greeting_with_name)).join(esc(c.greeting_fallback));
          return out
            .split("{{first_name}}").join(esc(sample[locale] ?? "Alex"))
            .split("{{offer_url}}").join(esc(`${c.site_url}/pricing?promo=PREVIEW&utm_content=${cohort}`))
            .split("{{unsubscribe_url}}").join(esc(`${c.site_url}/unsubscribe?t=PREVIEW`))
            .split("{{ends_at_display}}").join(esc(c.ends_at_display[cohort]));
        };
        const base = `${locale}-${cohort}${withName ? "" : "-noname"}`;
        const previewHtml = fill(html, true).split(escapeHtml(c.image_url)).join(imageCopy.split("/").pop())
          .split(escapeHtml(c.logo_url)).join("logo.png");
        writeFileSync(join(previewDir, `${base}.html`), previewHtml);
        writeFileSync(join(previewDir, `${base}.txt`), fill(text, false));
      }
    }
  }
  console.log(`previews in ${previewDir}`);
}

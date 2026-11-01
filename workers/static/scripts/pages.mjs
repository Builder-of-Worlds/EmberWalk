import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAX_EXTRA_WALKS, OFFER_CONFIG } from "../../../packages/shared/src/billing.ts";
import { ENTITY } from "../../../packages/shared/src/entity.ts";

export const ORIGIN = "https://emberwalk.app";
const STATIC = fileURLToPath(new URL("../", import.meta.url));
const PAGES = path.join(STATIC, "pages");
const PUBLIC = path.join(STATIC, "public");
const HAND_PAGES = ["/"];
const FOOTER_PAGES = [
  ["Pricing", "/pricing"],
  ["Terms", "/terms"],
  ["Privacy Policy", "/privacy"],
  ["Refunds", "/refunds"],
  ["About", "/about"],
  ["Contact", "/contact"],
  ["Security", "/security"],
  ["Accessibility", "/accessibility"],
];
const MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
const SHARE_ALT = "The EmberWalk shield and house mark with the words Wildfire Home Check, and the question: When the next wildfire comes, will your home be ready?";

export function readSources() {
  const pages = {};
  for (const file of readdirSync(PAGES).filter((name) => name.endsWith(".md")).sort()) {
    pages[file.slice(0, -3)] = readFileSync(path.join(PAGES, file), "utf8");
  }
  return {
    site: JSON.parse(readFileSync(path.join(PAGES, "site.json"), "utf8")),
    entity: ENTITY,
    offers: OFFER_CONFIG,
    pages,
    indexHtml: readFileSync(path.join(PUBLIC, "index.html"), "utf8"),
  };
}

function escape(text) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function isoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? date : null;
}

function ordinal(day) {
  if (day % 100 >= 11 && day % 100 <= 13) return `${day}th`;
  return `${day}${{ 1: "st", 2: "nd", 3: "rd" }[day % 10] ?? "th"}`;
}

function spokenDate(date) {
  return `${MONTHS[date.getUTCMonth()]} ${ordinal(date.getUTCDate())}, ${date.getUTCFullYear()}`;
}

function inline(text, name, known) {
  if (/[<>]/.test(text)) throw new Error(`${name}: raw HTML is not allowed: ${text}`);
  return text
    .replace(/&/g, "&amp;")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_all, label, href) => {
      if (href.includes('"')) throw new Error(`${name}: a link address may not hold a quote: ${href}`);
      const outside = href.startsWith("mailto:") || href.startsWith("https://");
      if (!outside && !known.has(href)) throw new Error(`${name}: link to a page that does not exist: ${href}`);
      return `<a href="${href}">${label}</a>`;
    })
    .replaceAll(POSTAL_TOKEN, POSTAL_MARK);
}

const CONTACT = "{{contact}}";
const POSTAL_TOKEN = "{{postalAddress}}";
const POSTAL_MARK = "<span data-postal-address></span>";

function entityText(line, name, entity) {
  return line.replace(/\{\{(\w+)\}\}/g, (_all, key) => {
    if (key === "contact") throw new Error(`${name}: the contact block stands on its own line: ${CONTACT}`);
    if (key === "postalAddress") {
      if (name !== "contact") throw new Error(`${name}: the postal address is printed on the Contact page only`);
      return POSTAL_TOKEN;
    }
    if (!entity) throw new Error(`${name}: {{${key}}} needs the entity block`);
    if (!Object.hasOwn(entity, key)) throw new Error(`${name}: unknown entity value: ${key}`);
    return entity[key];
  });
}

function contactBlock(name, entity, known) {
  if (!entity) throw new Error(`${name}: ${CONTACT} needs the entity block`);
  const email = escape(entity.supportEmail);
  return `<p class="rise contact">${inline(entity.legalName, name, known)}<br><a href="mailto:${email}">${email}</a></p>`;
}

export function parsePage(name, text, known, entity) {
  const lines = text.split("\n").map((line) => (line === CONTACT ? line : entityText(line, name, entity)));
  if (text.includes("```")) throw new Error(`${name}: a code fence is not allowed`);
  if ((text.match(/last\s+updated\s*:/gi) ?? []).length > 1) throw new Error(`${name}: Last updated is given more than once; the renderer prints the one header date`);
  const titleLine = lines[0] ?? "";
  if (!titleLine.startsWith("# ")) throw new Error(`${name}: the first line must be the title (# ...)`);
  const head = {};
  let at = 1;
  for (; at < lines.length && lines[at] !== ""; at++) {
    const match = /^(Description|Last updated|Status): (.+)$/.exec(lines[at]);
    if (!match) throw new Error(`${name}: unknown header line: ${lines[at]}`);
    if (head[match[1]] !== undefined) throw new Error(`${name}: ${match[1]} is given twice`);
    head[match[1]] = match[2];
  }
  if (!head.Description) throw new Error(`${name}: Description is missing`);
  if (titleLine.includes(POSTAL_TOKEN) || head.Description.includes(POSTAL_TOKEN)) throw new Error(`${name}: the postal address stays out of the title and description`);
  const updated = isoDate(head["Last updated"] ?? "");
  if (!updated) throw new Error(`${name}: Last updated must be one YYYY-MM-DD date`);
  if (head.Status !== undefined && head.Status !== "draft") throw new Error(`${name}: Status may only be draft`);

  const blocks = [];
  let list = null;
  const closeList = () => {
    if (list) blocks.push(`<ul class="rise">\n${list.map((item) => `          <li>${item}</li>`).join("\n")}\n        </ul>`);
    list = null;
  };
  for (const line of lines.slice(at)) {
    if (line.trim() === "") {
      closeList();
    } else if (line === CONTACT) {
      closeList();
      blocks.push(contactBlock(name, entity, known));
    } else if (line.startsWith("# ")) {
      throw new Error(`${name}: a second title is not allowed`);
    } else if (line.startsWith("### ")) {
      closeList();
      blocks.push(`<h3 class="rise">${inline(line.slice(4), name, known)}</h3>`);
    } else if (line.startsWith("## ")) {
      closeList();
      blocks.push(`<h2 class="rise">${inline(line.slice(3), name, known)}</h2>`);
    } else if (line.startsWith("- ")) {
      (list ??= []).push(inline(line.slice(2), name, known));
    } else {
      closeList();
      blocks.push(`<p class="rise">${inline(line, name, known)}</p>`);
    }
  }
  closeList();
  return {
    name,
    title: inline(titleLine.slice(2), name, known),
    titleText: titleLine.slice(2),
    description: head.Description,
    updated: head["Last updated"],
    updatedDate: updated,
    draft: head.Status === "draft",
    blocks,
  };
}

function dollars(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

export function offerValues(offers) {
  const plan = (kind) => offers.offers.find((offer) => offer.kind === kind);
  return {
    individualPrice: dollars(plan("individual").amountCents),
    individualWalks: String(plan("individual").walksPerYear),
    landlordPrice: dollars(plan("landlord").amountCents),
    landlordWalks: String(plan("landlord").walksPerYear),
    extraWalkPrice: dollars(offers.extraWalk.amountCents),
    extraWalkLimit: String(MAX_EXTRA_WALKS),
  };
}

function footer(entity, known) {
  for (const [, href] of FOOTER_PAGES) {
    if (!known.has(href)) throw new Error(`footer: the page it links to does not exist: ${href}`);
  }
  const links = FOOTER_PAGES.map(([label, href]) => `<a href="${href}">${label}</a>`);
  return [
    '  <footer class="site-footer">',
    `    <nav class="footer-links" aria-label="Site">${[...links, `<a href="mailto:${entity.supportEmail}">${entity.supportEmail}</a>`].join(" ")}</nav>`,
    `    <small class="seller">${entity.sellerLine}</small>`,
    "  </footer>",
  ].join("\n");
}

const SITE_CSS = '  <link rel="stylesheet" href="/site.css">\n';
const PAGES_CSS = '  <link rel="stylesheet" href="/pages.css">\n';
const FOOTER_BLOCK = / {2}<footer class="site-footer">\n[\s\S]*?\n {2}<\/footer>\n/;

function withFooter(file, html, entity, known) {
  if (html.split(SITE_CSS).length !== 2 || html.split("</body>").length !== 2) throw new Error(`${file}: needs one site.css link and one closing body tag`);
  const linked = html.includes(PAGES_CSS) ? html : html.replace(SITE_CSS, SITE_CSS + PAGES_CSS);
  return linked.replace(FOOTER_BLOCK, "").replace("</body>", `${footer(entity, known)}\n</body>`);
}

function renderPage(page, entity, known) {
  const indexed = page.name !== "404";
  const url = `${ORIGIN}/${page.name}`;
  const title = escape(`${page.titleText} | EmberWalk`);
  const description = escape(page.description);
  const body = [...page.blocks];
  if (indexed) body.push(`<p class="rise updated">Last updated: ${spokenDate(page.updatedDate)}.</p>`);
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${title}</title>`,
    `  <meta name="description" content="${description}">`,
    indexed ? `  <link rel="canonical" href="${url}">` : '  <meta name="robots" content="noindex">',
    '  <meta name="theme-color" content="#1a271e">',
    '  <link rel="icon" href="/brand/icon-32.png" type="image/png" sizes="32x32">',
    '  <link rel="icon" href="/brand/icon.svg" type="image/svg+xml">',
    '  <link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">',
    '  <meta property="og:type" content="website">',
    '  <meta property="og:site_name" content="EmberWalk">',
    `  <meta property="og:url" content="${url}">`,
    `  <meta property="og:title" content="${title}">`,
    `  <meta property="og:description" content="${description}">`,
    `  <meta property="og:image" content="${ORIGIN}/brand/share-card.png">`,
    '  <meta property="og:image:type" content="image/png">',
    '  <meta property="og:image:width" content="1200">',
    '  <meta property="og:image:height" content="630">',
    `  <meta property="og:image:alt" content="${SHARE_ALT}">`,
    '  <meta name="twitter:card" content="summary_large_image">',
    `  <meta name="twitter:title" content="${title}">`,
    `  <meta name="twitter:description" content="${description}">`,
    `  <meta name="twitter:image" content="${ORIGIN}/brand/share-card.png">`,
    `  <meta name="twitter:image:alt" content="${SHARE_ALT}">`,
    '  <link rel="preload" href="/fonts/atkinson-hyperlegible-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>',
    '  <link rel="preload" href="/fonts/atkinson-hyperlegible-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>',
    '  <link rel="stylesheet" href="/site.css">',
    '  <link rel="stylesheet" href="/pages.css">',
    '  <script src="/boot.js"></script>',
    '  <script type="module" src="/site.js"></script>',
    "</head>",
    "<body>",
    '  <header class="topbar">',
    '    <a class="wordmark" href="/">EmberWalk</a>',
    "  </header>",
    "",
    "  <main>",
    '    <section class="block">',
    '      <div class="column prose card">',
    `        <h1 class="rise">${page.title}</h1>`,
    ...body.map((block) => `        ${block}`),
    "      </div>",
    "    </section>",
    "  </main>",
    footer(entity, known),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function sitemap(pages) {
  const entries = [
    `  <url><loc>${ORIGIN}/</loc></url>`,
    ...pages.filter((page) => page.name !== "404").map((page) => `  <url><loc>${ORIGIN}/${page.name}</loc><lastmod>${page.updated}</lastmod></url>`),
  ];
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...entries, "</urlset>", ""].join("\n");
}

function securityTxt(site) {
  const from = isoDate(site.securityTxtDate);
  if (!from) throw new Error("site.json: securityTxtDate must be one YYYY-MM-DD date");
  const expires = new Date(from.getTime() + 364 * 86_400_000);
  return [
    `Contact: mailto:${site.securityContact}`,
    `Expires: ${expires.toISOString()}`,
    `Canonical: ${ORIGIN}/.well-known/security.txt`,
    "Preferred-Languages: en",
    "",
  ].join("\n");
}

export function renderAll(sources) {
  const names = Object.keys(sources.pages).sort();
  const known = new Set([...HAND_PAGES, ...names.map((name) => `/${name}`)]);
  const values = { ...sources.entity, ...offerValues(sources.offers) };
  const pages = names.map((name) => parsePage(name, sources.pages[name], known, values));
  const out = new Map();
  for (const page of pages) out.set(`${page.name}.html`, renderPage(page, sources.entity, known));
  out.set("index.html", withFooter("index.html", sources.indexHtml, sources.entity, known));
  out.set("sitemap.xml", sitemap(pages));
  out.set("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  out.set(".well-known/security.txt", securityTxt(sources.site));
  return out;
}

export function deployProblems(sources) {
  const problems = [];
  for (const [key, value] of Object.entries(sources.site)) {
    if (String(value).includes("TBD")) problems.push(`site.json ${key} is TBD`);
  }
  for (const [key, value] of Object.entries(sources.entity)) {
    if (String(value).includes("TBD")) problems.push(`entity.ts ${key} is TBD`);
  }
  for (const [name, text] of Object.entries(sources.pages)) {
    if (text.includes("TBD")) problems.push(`pages/${name}.md holds TBD`);
    if (/^Status: draft$/m.test(text)) problems.push(`pages/${name}.md is a draft, not yet approved`);
  }
  return problems;
}

function main(args) {
  const sources = readSources();
  const out = renderAll(sources);
  const dirAt = args.indexOf("--dir");
  const target = dirAt === -1 ? PUBLIC : path.resolve(args[dirAt + 1] ?? "");
  if (args.includes("--check-deploy")) {
    const problems = deployProblems(sources);
    for (const line of problems) console.error(line);
    return problems.length === 0 ? 0 : 1;
  }
  if (args.includes("--check")) {
    const stale = [...out].filter(([file, content]) => {
      try {
        return readFileSync(path.join(target, file), "utf8") !== content;
      } catch {
        return true;
      }
    });
    for (const [file] of stale) console.error(`${file} is missing or differs from its source; run node workers/static/scripts/pages.mjs`);
    return stale.length === 0 ? 0 : 1;
  }
  for (const [file, content] of out) {
    mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
    writeFileSync(path.join(target, file), content);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));

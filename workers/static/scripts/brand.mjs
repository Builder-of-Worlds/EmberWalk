import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const PUBLIC = fileURLToPath(new URL("../public/", import.meta.url));
const BRAND = `${PUBLIC}brand/`;

export const COLORS = {
  leaf: "#3d5a40",
  moss: "#5d6f4a",
  paper: "#f7f3e6",
  sand: "#ece6d4",
  stone: "#d9d2bd",
  muted: "#5a5546",
  dayFrom: "#c2561a",
  dayTo: "#b9780a",
  nightFrom: "#f08a3c",
  nightTo: "#f5c24c",
};
export const HEADLINE = "When the next wildfire comes, will your home be ready?";
const C = COLORS;
const SHIELD = "M60 8 L100 22 V58 C100 84 82 102 60 112 C38 102 20 84 20 58 V22 Z";
const scaled = (s) => `translate(60 61) scale(${s}) translate(-60 -61)`;

function house(body, cut, windows = true) {
  const openings = windows
    ? `<rect x="41" y="66" width="9" height="9" fill="${cut}"/><rect x="70" y="66" width="9" height="9" fill="${cut}"/><rect x="54" y="68" width="12" height="20" rx="1.5" fill="${cut}"/>`
    : `<rect x="53" y="67" width="14" height="21" fill="${cut}"/>`;
  return `<rect x="72" y="34" width="9" height="20" fill="${body}"/>`
    + `<path d="M31 63 L60 31 L89 63 Z" fill="${body}" stroke="${body}" stroke-width="3" stroke-linejoin="round"/>`
    + `<rect x="36" y="58" width="48" height="30" fill="${body}"/>${openings}`;
}

function markBody(tone) {
  const [ring, band, inner, body, cut] = tone === "dark"
    ? [C.paper, C.stone, C.paper, C.leaf, C.paper]
    : [C.leaf, C.moss, C.leaf, C.paper, C.leaf];
  return `<path d="${SHIELD}" fill="none" stroke="${ring}" stroke-width="3.2" stroke-linejoin="round"/>`
    + `<path d="${SHIELD}" transform="${scaled(0.86)}" fill="${band}"/>`
    + `<path d="${SHIELD}" transform="${scaled(0.74)}" fill="${inner}"/>`
    + `<g transform="translate(60 54.5) scale(0.6) translate(-60 -60)">${house(body, cut)}</g>`;
}

const iconBody = () => `<path d="${SHIELD}" fill="${C.leaf}"/>`
  + `<g transform="translate(60 52) scale(0.86) translate(-60 -60)">${house(C.paper, C.leaf, false)}</g>`;

const svg = (body, viewBox = "0 0 120 120") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>\n`;

export const FILES = {
  "mark.svg": svg(markBody("light"), "17 5 86 110"),
  "mark-dark.svg": svg(markBody("dark"), "17 5 86 110"),
  "icon.svg": svg(iconBody(), "10 0 100 120"),
};

const fontData = (weight) => readFileSync(`${PUBLIC}fonts/atkinson-hyperlegible-latin-${weight}-normal.woff2`).toString("base64");
const font = (weight) => `@font-face { font-family: Atkinson; font-weight: ${weight}; src: url(data:font/woff2;base64,${fontData(weight)}); }`;
const inline = (file) => `data:image/svg+xml;base64,${Buffer.from(FILES[file]).toString("base64")}`;

function lockup(tone, size) {
  const [from, to, line, mark] = tone === "dark"
    ? [C.nightFrom, C.nightTo, C.stone, "mark-dark.svg"]
    : [C.dayFrom, C.dayTo, C.muted, "mark.svg"];
  return `<div class="lockup" style="--size:${size}px">
<img src="${inline(mark)}" alt="">
<div class="words"><div class="name" style="background-image:linear-gradient(90deg, ${from}, ${to})">EMBERWALK</div><div class="line" style="color:${line}">WILDFIRE HOME CHECK</div></div></div>`;
}

const PAGE_STYLE = `${font(400)} ${font(700)}
* { margin: 0; box-sizing: border-box; }
body { font-family: Atkinson; }
.lockup { display: inline-flex; align-items: center; gap: calc(var(--size) * 0.5); padding: calc(var(--size) * 0.1); }
.lockup img { height: calc(var(--size) * 1.8); }
.name { font-size: var(--size); font-weight: 700; letter-spacing: 0.06em; line-height: 1; width: max-content; padding-left: 0.04em; background-clip: text; -webkit-background-clip: text; color: transparent; }
.line { font-weight: 700; line-height: 1; width: max-content; margin-top: calc(var(--size) * 0.24); white-space: nowrap; }
.card { width: 1200px; height: 630px; background: ${C.leaf}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 56px; padding: 0 96px; }
.card h1 { color: ${C.paper}; font-size: 64px; line-height: 1.15; text-align: center; font-weight: 700; max-width: 960px; }`;

const FIT_LINE = `for (const words of document.querySelectorAll(".words")) {
  const name = words.querySelector(".name"), line = words.querySelector(".line");
  const fit = (size) => { line.style.fontSize = size + "px"; line.style.letterSpacing = size * 0.16 + "px"; };
  const trial = parseFloat(getComputedStyle(name).fontSize) * 0.3;
  fit(trial);
  fit(trial * name.getBoundingClientRect().width / line.getBoundingClientRect().width);
}`;

async function shoot(browser, html, path, { width, height, scale = 1, selector, dir }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  try {
    await page.setContent(`<!doctype html><style>${PAGE_STYLE}</style>${html}`, { waitUntil: "load" });
    await page.evaluate("Promise.all([document.fonts.ready, ...[...document.images].map((image) => image.decode())]).then(() => true)");
    await page.evaluate(FIT_LINE);
    const target = selector ? page.locator(selector) : page;
    await target.screenshot({ path: `${dir}${path}`, omitBackground: true });
  } finally {
    await page.close();
  }
}

const square = (file, size, fill, scale) => `<div style="width:${size}px;height:${size}px;background:${fill};display:grid;place-items:center">
<img src="${inline(file)}" style="height:${Math.round(size * scale)}px"></div>`;

export async function render(dir = BRAND) {
  const executablePath = process.env.EMBERWALK_CHROMIUM;
  if (!executablePath) throw new Error("Set EMBERWALK_CHROMIUM to a Chromium binary; browsers run headless only.");
  for (const [name, body] of Object.entries(FILES)) writeFileSync(`${dir}${name}`, body);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    await shoot(browser, square("icon.svg", 32, "transparent", 1), "icon-32.png", { width: 32, height: 32, dir });
    await shoot(browser, square("mark.svg", 180, C.paper, 0.78), "apple-touch-icon.png", { width: 180, height: 180, dir });
    await shoot(browser, square("mark.svg", 192, C.paper, 0.8), "icon-192.png", { width: 192, height: 192, dir });
    await shoot(browser, square("mark.svg", 512, C.paper, 0.8), "icon-512.png", { width: 512, height: 512, dir });
    await shoot(browser, square("mark-dark.svg", 512, C.leaf, 0.6), "icon-maskable-512.png", { width: 512, height: 512, dir });
    await shoot(browser, `<div class="card">${lockup("dark", 64)}<h1>${HEADLINE}</h1></div>`, "share-card.png", { width: 1200, height: 630, dir });
    await shoot(browser, lockup("light", 48), "lockup.png", { width: 900, height: 200, scale: 2, selector: ".lockup", dir });
    await shoot(browser, lockup("dark", 48), "lockup-dark.png", { width: 900, height: 200, scale: 2, selector: ".lockup", dir });
  } finally {
    await browser.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await render();

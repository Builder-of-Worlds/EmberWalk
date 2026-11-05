// node scripts/judge-media.mjs check | record. deploy.sh runs check; record writes the approved list once the media have passed by eye.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REQUIRED = ["film/master.m3u8","judges-video-poster.jpg", "walk/desktop/master.m3u8", "walk/phone/master.m3u8", "hls.light.min.js", "walk-poster.jpg", "report.pdf"];

const APP_FILE = /^(index\.html|sw\.js|icon\.svg|manifest\.webmanifest|hls\.light\.min\.js|\.assetsignore|_redirects|assets\/[^/]+\.(js|css))$/;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

const mediaIn = (dist) =>
  readdirSync(dist, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(dist, path.join(entry.parentPath, entry.name)))
    .filter((name) => !APP_FILE.test(name))
    .sort();

export const mediaProblems = (dist, manifest, resultText) => {
  const problems = REQUIRED.filter((name) => !existsSync(path.join(dist, name))).map((name) => `${name} is missing`);
  if (resultText === null) problems.push("no real result is in apps/web/src/samples/hero-before.json");
  else if (sha(resultText) !== manifest.result) problems.push("the result changed since its media were approved");
  const found = mediaIn(dist);
  for (const name of found) {
    const hash = sha(readFileSync(path.join(dist, name)));
    if (manifest.refused.includes(hash)) problems.push(`${name} is old-scene media`);
    else if (manifest.approved[name] === undefined) problems.push(`${name} is not on the approved list`);
    else if (manifest.approved[name] !== hash) problems.push(`${name} does not match its approved hash`);
  }
  for (const name of Object.keys(manifest.approved)) if (!found.includes(name)) problems.push(`${name} is approved but missing`);
  return problems;
};

const squeezed = (text) => text.replace(/\s+/g, "");

export const recorded = (dist, manifest, resultText, pdfText) => {
  if (resultText === null) throw new Error("no real result is in apps/web/src/samples/hero-before.json");
  const said = squeezed(pdfText(path.join(dist, "report.pdf")));
  for (const { instruction } of JSON.parse(resultText).findings) if (!said.includes(squeezed(instruction))) throw new Error(`report.pdf does not say: ${instruction}`);
  const approved = {};
  for (const name of mediaIn(dist)) {
    const hash = sha(readFileSync(path.join(dist, name)));
    if (manifest.refused.includes(hash)) throw new Error(`${name} is old-scene media`);
    approved[name] = hash;
  }
  return { ...manifest, approved, result: sha(resultText) };
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = "apps/web/dist/judge";
  const file = "workers/judges/media-manifest.json";
  const resultFile = "apps/web/src/samples/hero-before.json";
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const resultText = existsSync(resultFile) ? readFileSync(resultFile, "utf8") : null;
  if (process.argv[2] === "record") {
    const next = recorded(dist, manifest, resultText, (pdf) => execFileSync("pdftotext", [pdf, "-"], { encoding: "utf8" }));
    writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`JUDGE MEDIA recorded ${Object.keys(next.approved).length} files`);
  } else {
    const problems = mediaProblems(dist, manifest, resultText);
    for (const problem of problems) console.log(`JUDGE MEDIA: ${problem}`);
    process.exit(problems.length === 0 ? 0 : 1);
  }
}

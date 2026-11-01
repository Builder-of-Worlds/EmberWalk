import { isCorner } from "@emberwalk/shared";
import type { Band, ResultFinding, ResultSource, WalkResultsResponse } from "@emberwalk/shared";
import { FONT_400_URL, FONT_700_URL, LOCKUP_URL } from "./report-assets.ts";
import { type GapKind, type RecheckResult, longDay, reportWords as w, shortDay } from "./report-words.ts";

export type MarkStatus = "needs_fixing" | "fix_planned" | "done";

export type Mark = { findingId: string; status: MarkStatus; doneOn: string | null; markedAt: string };

export type RecheckAnswer = { findingId: string; result: RecheckResult; createdAt: string };

export type ShownStatus = { kind: "needs_fixing" } | { kind: "fix_planned" } | { kind: "done"; doneOn: string | null } | { kind: "rechecked"; on: string };

export type ReportInput = {
  results: Pick<WalkResultsResponse, "walkedOn" | "findings" | "gaps" | "notChecked" | "coverage">;
  statuses: ReadonlyMap<string, MarkStatus>;
  marks: Mark[];
  rechecks: RecheckAnswer[];
  stills: ReadonlyMap<string, string>;
  removed: ReadonlySet<string>;
  approvedAt: string | null;
  templates: ReadonlyMap<string, string>;
  personal: readonly string[];
};

const anyCase = (words: string): string => words.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);

const NOT_NAME = `${anyCase(
  "feet|foot|ft|inch|inches|yards?|meters?|metres?|pies?|metros?|an|the|and|or|to|of|in|on|at|by|for|from|with|along|near|past|behind|around|across|beside|under|over|off|up|down|each|every|this|that|your|its|en|con|por|para|sin|junto|cerca|lejos|hacia|desde|hasta|sobre|bajo|entre|su|sus|un|una",
)}|a|de|del|al|y|o|los|las`;

const NAME_WORD = `(?!(?:${NOT_NAME})(?![\\p{L}\\p{N}]))[\\p{L}\\p{N}.'-]+`;

const STREET_TYPE = anyCase(
  "street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|court|ct|boulevard|blvd|place|pl|circle|cir|terrace|ter|trail|trl|parkway|pkwy|highway|hwy|loop|run|route|rte|path|pike|alley|aly|cove|cv|plaza|plz|square|sq|row|park|pass|heights|hts|hollow|ridge|rdg|canyon|creek|point|pt|walk|vista|crossing|xing|hill|bend|grove|turnpike|tpke|expressway|expy|freeway|fwy|calle|avenida|camino",
);

const LEADING_TYPE = anyCase("calle|avenida|camino|highway|hwy|route|rte|via|paseo|rue|avenue|ave");

const NUMBER = "\\b\\d{1,6}[a-zA-Z]?\\s+";

const ORDINARY = new Set(
  "fence brush ash ember pine oak shrub log vent gutter cedar mulch grass tree branch leaf pile wood firewood deck roof wall shed tank propane bush hedge weed needle stack tarp bin bag trash lumber siding eave porch patio yard fire burn smoke flame spark lawn plant vine cypress juniper sage palm fir elm cerca lena pasto".split(
    " ",
  ),
);

const PERSONAL = {
  email: /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i,
  phone: /\d(?:[\s().-]*\d){6,}/,
  zip: /\b\d{5}(?:-\d{4})?\b/,
  spokenEmail: /[a-z0-9._%+-]+\s+at\s+[a-z0-9-]+(?:\s+dot\s+[a-z0-9-]+)+/i,
  box: /\b(?:P\.?\s?O\.?\s?(?:Box|Drawer|B\.?)|Post\s+Office\s+(?:Box|Drawer))\s*#?\s*(?:\d|[a-z]\b)/i,
  ruralBox: /\b(?:RR|HC|Rural\s+Route|Highway\s+Contract)\s*\d+\s*Box\s*\d/i,
  article: new RegExp(`${NUMBER}(?:Del|DEL|Las|LAS|Los|LOS|La|LA|El|EL)\\s+\\p{Lu}\\p{L}`, "u"),
  vistaDelMar: new RegExp(`${NUMBER}(?:${NAME_WORD}\\s+){0,3}\\p{Lu}\\p{L}*\\s+(?:del|de\\s+la|de\\s+los|de\\s+las)\\s+\\p{Lu}\\p{L}`, "u"),
  numbered: new RegExp(`${NUMBER}(?:(?:CR|SR|US|FM|RM|RR|HC)\\s*-?\\s*\\d|[Ii]nterstate\\s+\\d)|\\bI-\\d`),
  broadway: new RegExp(`${NUMBER}(?:${anyCase("broadway|embarcadero|esplanade|promenade|boardwalk|midway")})\\b`),
  street: new RegExp(`${NUMBER}(?:(?:${NAME_WORD}\\s+){1,4}(?:${STREET_TYPE})\\b|(?:${LEADING_TYPE})\\s+[\\p{L}\\p{N}])`, "u"),
};

const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const folded = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC").replaceAll("’", "'");

const capitalized = (value: string, ending: "" | "?"): RegExp => {
  const [head = "", ...tail] = [...value];
  const rest = anyCase(escaped(tail.join("").toLowerCase()));
  return new RegExp(`(?<=[\\p{L}\\p{N},;:]\\s+["'“‘(]?)${escaped(head.toUpperCase())}${rest}(?:es|s)${ending}(?![\\p{L}\\p{N}])`, "u");
};

const holdsWord = (text: string, value: string): boolean => {
  const stored = folded(value);
  const spoken = folded(text);
  if (ORDINARY.has(stored.toLowerCase())) return capitalized(stored, "?").test(spoken);
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped(stored)}(?![\\p{L}\\p{N}])`, "iu").test(spoken) || capitalized(stored, "").test(spoken);
};

const holdsPersonal = (text: string, personal: readonly string[]): boolean =>
  Object.values(PERSONAL).some((pattern) => pattern.test(text)) || personal.some((value) => value.trim().length > 0 && holdsWord(text, value.trim()));

const BANDS: Band[] = ["zone_0", "zone_1", "zone_2"];

const FIX_FIRST_FEET = 30;

export const STILL_DATA = "data:image/jpeg;base64,";

export const PDF_OPTIONS = { format: "letter", printBackground: true, preferCSSPageSize: true } as const;

type Ordered = { first: ResultFinding[]; bands: { band: Band; findings: ResultFinding[] }[] };

const byId = (a: ResultFinding, b: ResultFinding) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const byLabel = (a: ResultFinding, b: ResultFinding) => Number(a.label !== "required_now") - Number(b.label !== "required_now");

const byDistance = (a: ResultFinding, b: ResultFinding) => a.distanceFeet.low - b.distanceFeet.low || a.distanceFeet.high - b.distanceFeet.high;

const fixOrder = (a: ResultFinding, b: ResultFinding): number => byLabel(a, b) || byDistance(a, b) || byId(a, b);

const nearOrder = (a: ResultFinding, b: ResultFinding): number => byDistance(a, b) || byLabel(a, b) || byId(a, b);

const blocksGreen = (f: ResultFinding): boolean => f.label === "required_now" || f.band === "zone_0";

export const reportOrder = (results: Pick<WalkResultsResponse, "findings" | "gaps">, cleared: (f: ResultFinding) => boolean): Ordered => {
  const sideGaps = results.gaps.filter((g) => !isCorner(g.side));
  const blocking = results.findings.filter((f) => blocksGreen(f) && !cleared(f));
  const near = results.findings.filter((f) => !cleared(f) && f.distanceFeet.low < FIX_FIRST_FEET).sort(nearOrder);
  const first = sideGaps.length > 0 || blocking.length === 0 ? [] : near.length > 0 ? near : [...blocking].sort(nearOrder);
  const rest = results.findings.filter((f) => !first.includes(f));
  return {
    first,
    bands: BANDS.map((band) => ({ band, findings: rest.filter((f) => f.band === band).sort(fixOrder) })).filter((b) => b.findings.length > 0),
  };
};

const latest = <T>(items: T[], at: (item: T) => string): T | undefined => [...items].sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0)).at(-1);

export const statusOf = (findingId: string, status: MarkStatus, marks: Mark[], rechecks: RecheckAnswer[]): ShownStatus => {
  if (status !== "done") return { kind: status };
  const answer = latest(rechecks.filter((r) => r.findingId === findingId), (r) => r.createdAt);
  if (answer?.result === "cleared") return { kind: "rechecked", on: answer.createdAt.slice(0, 10) };
  const done = latest(marks.filter((m) => m.findingId === findingId && m.status === "done"), (m) => m.markedAt);
  return { kind: "done", doneOn: done?.doneOn ?? null };
};

const esc = (text: string): string =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const statusLines = (status: ShownStatus): string[] => {
  if (status.kind === "rechecked") return [w.rechecked, w.recheckedOn(status.on)];
  if (status.kind !== "done") return [w.status[status.kind]];
  return [w.status.done, ...(status.doneOn === null ? [] : [w.doneOn(status.doneOn)]), w.notRechecked];
};

const pictureOf = (said: string, still: string | undefined, number?: number): string =>
  still !== undefined && still.startsWith(STILL_DATA)
    ? `<div class="photo"><img src="${still}" alt="${esc(w.photo(said))}">${number === undefined ? "" : `<span class="num">${number}</span>`}</div>`
    : "";

const removedOf = (f: ResultFinding): string => w.removedItem(f.concept, f.distanceFeet.low, f.distanceFeet.high);

const saidOf = (f: ResultFinding, input: Pick<ReportInput, "templates" | "personal">): string =>
  holdsPersonal(f.instruction, input.personal) ? (input.templates.get(f.id) ?? removedOf(f)) : f.instruction;

const CHIP_OF_STATUS: Record<ShownStatus["kind"], string> = { needs_fixing: "needs", fix_planned: "planned", done: "done", rechecked: "rechecked" };

const row = (f: ResultFinding, status: ShownStatus, still: string | undefined, said: string, number?: number): string => {
  const [chip = "", ...notes] = statusLines(status);
  return [
    `<li class="finding" data-finding="${esc(f.id)}" data-status="${status.kind}">`,
    pictureOf(said, still, number),
    `<p class="say">${esc(said)}</p>`,
    `<p class="where" data-part="distance">${esc(w.distance(f.distanceFeet.low, f.distanceFeet.high))}</p>`,
    '<div class="chips">',
    `<div><span class="cap">${esc(w.caption.band)}</span><p class="chip zone" data-part="band">${esc(w.bands[f.band])}</p></div>`,
    `<div><span class="cap">${esc(w.caption.label)}</span><p class="chip ${f.label === "required_now" ? "required" : "recommended"}" data-part="label">${esc(w.label[f.label])}</p></div>`,
    `<div data-part="status"><span class="cap">${esc(w.caption.status)}</span><p class="chip ${CHIP_OF_STATUS[status.kind]}">${esc(chip)}</p>${notes.map((line) => `<p class="sub">${esc(line)}</p>`).join("")}</div>`,
    "</div>",
    `<p class="source" data-part="sources">${esc(w.source)}: <strong>${f.sources.map((s) => esc(s.citation)).join("; ")}</strong></p>`,
    "</li>",
  ].join("");
};

type Line = { day: string; at: string; words: string };

const recordOf = (input: ReportInput, byId: ReadonlyMap<string, ResultFinding>): Line[] => {
  const walk = input.results.walkedOn;
  const lines: Line[] = [{ day: walk, at: "", words: w.walked(walk) }];
  if (input.approvedAt !== null) lines.push({ day: input.approvedAt.slice(0, 10), at: input.approvedAt, words: w.approved(input.approvedAt.slice(0, 10)) });
  for (const m of input.marks) {
    const f = byId.get(m.findingId);
    if (f === undefined) continue;
    const day = m.doneOn ?? m.markedAt.slice(0, 10);
    lines.push({ day, at: m.markedAt, words: w.mark(w.status[m.status], day, saidOf(f, input)) });
  }
  for (const r of input.rechecks) {
    const f = byId.get(r.findingId);
    if (f === undefined) continue;
    const day = r.createdAt.slice(0, 10);
    lines.push({ day, at: r.createdAt, words: w.recheck[r.result](day, saidOf(f, input)) });
  }
  return lines.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
};

const coverageLines = (input: ReportInput): string[] => {
  const gaps = input.results.gaps.filter((g) => !isCorner(g.side)).map((g) => w.gap[g.kind as GapKind](g.side));
  const notChecked = input.results.notChecked.map((c) => w.notChecked(c));
  const lines = [...gaps, ...notChecked];
  return lines.length === 0 && input.results.coverage === "checked" ? [w.allChecked] : lines;
};

const sourcesOf = (findings: ResultFinding[]): ResultSource[] => {
  const seen = new Map<string, ResultSource>();
  for (const s of findings.flatMap((f) => f.sources)) if (!seen.has(s.citation)) seen.set(s.citation, s);
  return [...seen.values()];
};

const cssText = (text: string): string => text.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

const FACES = (
  [
    [400, FONT_400_URL],
    [700, FONT_700_URL],
  ] as const
)
  .map(([weight, url]) => `@font-face{font-family:"Atkinson Hyperlegible";font-weight:${weight};src:url(${url}) format("woff2")}`)
  .join("");

const PAPER_STYLE = [
  ":root{--page:#fff;--forest:#22342a;--leaf:#3d5a40;--paper:#f7f3e6;--sand:#ece6d4;--stone:#d9d2bd;--ink:#2d2a22;--bark:#54402e;--muted:#5a5546;--ember:#c2561a;--required:#b3402a;--recommended:#c9971c}",
  "*{box-sizing:border-box}",
  "html{-webkit-print-color-adjust:exact;print-color-adjust:exact}",
  'body{margin:0;background:var(--page);color:var(--ink);font:400 10.5pt/1.45 "Atkinson Hyperlegible",system-ui,sans-serif;text-align:center}',
  "main{max-width:6.5in;margin:0 auto;padding:16px}",
  "@media print{main{max-width:none;padding:0}}",
  "h1,h2,p{margin:0}",
  "p{text-wrap:balance}",
  "a{overflow-wrap:anywhere}",
  ".cover{padding-bottom:14pt}",
  ".lockup{width:min(2.8in,70%);height:auto;display:block;margin:0 auto 14pt}",
  "h1{font-size:26pt;line-height:1.1;color:var(--forest)}",
  ".made{color:var(--muted);margin-top:4pt}",
  ".facts{display:flex;flex-wrap:wrap;justify-content:center;gap:6pt 28pt;margin:12pt 0 0}",
  ".facts p{font-size:9pt;color:var(--muted)}",
  ".facts strong{display:block;font-size:11pt;color:var(--ink)}",
  ".note{margin:14pt auto 0;max-width:5.6in;padding:9pt 14pt;background:var(--sand);border-radius:8pt;font-size:9.5pt}",
  ".note p+p{margin-top:2pt}",
  "h2{font-size:16pt;line-height:1.2;color:var(--forest);padding-top:16pt;break-after:avoid}",
  'h2::after{content:"";display:block;width:0.5in;height:2.5pt;background:var(--ember);margin:6pt auto 0;border-radius:2pt}',
  ".lead{color:var(--muted);margin:7pt auto 0;max-width:5.4in;break-after:avoid}",
  "ol,ul{list-style:none;margin:0;padding:0}",
  ".keep{break-inside:avoid}",
  ".finding{break-inside:avoid;padding-top:12pt;margin:0 auto;max-width:5.4in}",
  ".photo{position:relative;width:min(4.2in,100%);aspect-ratio:16/9;margin:0 auto;border-radius:8pt;overflow:hidden;background:var(--sand)}",
  ".photo img{width:100%;height:100%;object-fit:contain;display:block}",
  ".num{position:absolute;left:8pt;top:8pt;width:22pt;height:22pt;border-radius:50%;background:var(--forest);color:var(--paper);font-weight:700;font-size:11pt;line-height:22pt}",
  ".say{font-size:12.5pt;font-weight:700;line-height:1.3;margin:7pt auto 0;max-width:5in}",
  ".where{color:var(--muted);margin-top:3pt}",
  ".chips{display:flex;flex-wrap:wrap;justify-content:center;gap:6pt 16pt;margin-top:6pt}",
  ".chips>div{font-size:7.5pt;color:var(--muted)}",
  ".chip{display:block;margin-top:2pt;padding:2.5pt 9pt;border-radius:999pt;font-size:9pt;font-weight:700;line-height:1.3;border:1.2pt solid}",
  ".zone{border-color:var(--leaf);color:var(--forest)}",
  ".required{background:var(--required);border-color:var(--required);color:#fff}",
  ".recommended{background:var(--recommended);border-color:var(--recommended);color:var(--ink)}",
  ".needs{border-color:var(--required);color:var(--required)}",
  ".planned{border-color:var(--bark);color:var(--bark);background:var(--sand)}",
  ".done{border-color:var(--leaf);color:var(--forest);background:var(--paper)}",
  ".rechecked{background:var(--leaf);border-color:var(--leaf);color:var(--paper)}",
  ".sub{font-size:8pt;color:var(--muted);margin-top:2pt}",
  ".source{font-size:8.5pt;color:var(--muted);margin-top:5pt}",
  ".source strong{color:var(--ink)}",
  ".pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(2.6in,1fr));gap:0 24pt;align-items:start}",
  ".panel{margin:10pt auto 0;max-width:5.4in;padding:8pt 14pt;background:var(--sand);border-radius:8pt}",
  ".pair .panel{max-width:none}",
  ".panel li+li{margin-top:3pt}",
  ".removed{display:flex;flex-wrap:wrap;justify-content:center;gap:10pt;margin-top:8pt}",
  ".removed li{width:min(2.5in,100%)}",
  ".removed p{margin-top:5pt;font-size:10pt}",
  ".record{margin:10pt auto 0;max-width:5.6in;text-align:left;border-collapse:collapse;font-size:9.5pt}",
  ".record td{padding:4pt 0;vertical-align:top;border-bottom:0.75pt solid var(--stone)}",
  ".record tr{break-inside:avoid}",
  ".record td:first-child{width:1.25in;font-weight:700;padding-right:10pt;color:var(--forest)}",
  ".record p{text-align:left;text-wrap:wrap}",
  ".rules{margin:10pt auto 0;display:grid;grid-template-columns:repeat(auto-fit,minmax(1.9in,1fr));gap:8pt}",
  ".rule{border:1pt solid var(--stone);border-radius:8pt;padding:8pt 10pt;break-inside:avoid}",
  ".rule a{font-weight:700;color:var(--leaf);text-decoration:none}",
  ".rule p{font-size:9pt;margin-top:3pt}",
  ".rule p:first-child{font-size:inherit;margin-top:0}",
  ".rule .read{font-size:8pt;color:var(--muted);margin-top:2pt}",
].join("");

const styleOf = (walkedOn: string): string => {
  const footer = `${w.title}    ${w.walkedLabel} ${shortDay(walkedOn)}    ${w.page} `;
  return [
    FACES,
    `@page{size:letter;margin:0.95in 0.75in 0.8in;@top-center{content:image-set(url("${LOCKUP_URL}") 4x);vertical-align:bottom;padding-bottom:7pt;border-bottom:1.5pt solid #c2561a}`,
    `@bottom-center{content:"${cssText(footer)}" counter(page) " ${cssText(w.pageOf)} " counter(pages) "\\A ${cssText(w.notInspectionShort)}";white-space:pre;font:400 8pt/1.5 "Atkinson Hyperlegible",sans-serif;color:#5a5546;text-align:center;vertical-align:top;padding-top:8pt;border-top:0.75pt solid #d9d2bd}}`,
    "@page :first{margin-top:0.55in;@top-center{content:none;border:0}}",
    PAPER_STYLE,
  ].join("");
};

export const reportHtml = (input: ReportInput): string => {
  const findings = input.results.findings.filter((f) => !input.removed.has(f.id));
  const removed = input.results.findings.filter((f) => input.removed.has(f.id));
  const byId = new Map(findings.map((f) => [f.id, f]));
  const status = (f: ResultFinding): ShownStatus => statusOf(f.id, input.statuses.get(f.id) ?? "needs_fixing", input.marks, input.rechecks);
  const order = reportOrder({ findings, gaps: input.results.gaps }, (f) => status(f).kind === "rechecked");
  const rows = (list: ResultFinding[], numbered: boolean): string[] =>
    list.map((f, i) => row(f, status(f), input.stills.get(f.id), saidOf(f, input), numbered ? i + 1 : undefined));
  const listOf = (items: string[]): string => (items.length === 0 ? "" : `<ol class="findings">${items.join("")}</ol>`);
  const opened = (heading: string, lead: string, items: string[]): string =>
    `<div class="keep"><h2>${esc(heading)}</h2>${lead}${listOf(items.slice(0, 1))}</div>${listOf(items.slice(1))}`;
  const first =
    order.first.length === 0
      ? ""
      : `<section data-part="fix-first">${opened(w.fixFirst(order.first.length), `<p class="lead">${esc(w.lead)}</p>`, rows(order.first, true))}</section>`;
  const bands = order.bands.map((b) => `<section data-band="${b.band}">${opened(w.bands[b.band], "", rows(b.findings, false))}</section>`).join("");
  const coverage = `<section data-part="coverage"><h2>${esc(w.coverage)}</h2><ul class="panel">${coverageLines(input).map((l) => `<li><p>${esc(l)}</p></li>`).join("")}</ul></section>`;
  const record = `<div class="keep"><section data-part="record"><h2>${esc(w.record)}</h2><table class="record"><tbody>${recordOf(input, byId)
    .map((l) => `<tr data-day="${l.day}"><td>${esc(shortDay(l.day))}</td><td><p>${esc(l.words)}</p></td></tr>`)
    .join("")}</tbody></table></section></div>`;
  const rules = `<div class="keep"><section data-part="rules"><h2>${esc(w.rules)}</h2><ul class="rules">${sourcesOf(findings)
    .map(
      (s) =>
        `<li class="rule"><p><a href="${esc(s.url)}">${esc(s.citation)}</a></p><p>${esc(s.words)}</p><p class="read" data-part="retrieved">${esc(w.retrieved(s.retrievedOn))} ${esc(hostOf(s.url))}</p></li>`,
    )
    .join("")}</ul></section></div>`;
  const gone =
    removed.length === 0
      ? ""
      : `<section data-part="removed"><h2>${esc(w.removed)}</h2><p class="lead">${esc(w.removedLead)}</p><ul class="removed">${removed
          .map((f) => `<li data-finding="${esc(f.id)}">${pictureOf(removedOf(f), input.stills.get(f.id))}<p>${esc(removedOf(f))}</p></li>`)
          .join("")}</ul></section>`;
  const walked = `<p data-part="walked"><span class="k">${esc(w.walkedLabel)}</span><strong>${esc(longDay(input.results.walkedOn))}</strong></p>`;
  const approved =
    input.approvedAt === null
      ? ""
      : `<p data-part="approved"><span class="k">${esc(w.approvedLabel)}</span><strong>${esc(shortDay(input.approvedAt.slice(0, 10)))}</strong></p>`;
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'">`,
    `<title>${esc(w.title)}</title><style>${styleOf(input.results.walkedOn)}</style></head><body><main>`,
    `<header class="cover"><img class="lockup" src="${LOCKUP_URL}" alt="${esc(w.lockupAlt)}"><h1>${esc(w.title)}</h1><p class="made">${esc(w.made)}</p>`,
    `<div class="facts">${walked}${approved}</div>`,
    `<div class="note" data-part="not-inspection"><p>${esc(w.notInspection)}</p><p>${esc(w.approximate)}</p><p>${esc(w.zoneZero)}</p></div></header>`,
    first,
    bands,
    `<div class="pair keep">${coverage}${gone}</div>`,
    record,
    rules,
    "</main></body></html>",
  ].join("");
};

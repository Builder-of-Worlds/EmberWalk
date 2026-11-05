import { type FindingState, propertyMarks, propertyWalks, type PropertyWalkRecord, walkedDay } from "@emberwalk/db";
import { type Concept, type PortfolioErrorCode } from "@emberwalk/shared";
import { accountOf } from "./account.ts";
import { type BrowserBinding, pdfOf } from "./browser-run.ts";
import { ownProperty } from "./portfolio-route.ts";
import { esc } from "./report.ts";
import { answersOf, type PrintPdf } from "./report-route.ts";
import { CONCEPT_WORDS, reportWords as report, shortDay } from "./report-words.ts";

export type RecordEnv = { DB: D1Database; MEDIA: R2Bucket; BROWSER?: BrowserBinding };
export type RecordDeps = { print?: PrintPdf };

// Draft words: they wait for the owner's approval.
export const recordWords = {
  title: "Property Record",
  walked: (iso: string) => `Walked ${shortDay(iso)}`,
  noWalks: "No walks yet.",
  notFinished: "This walk did not finish.",
  stillChecking: "This walk was still being checked when this record was made.",
  noItems: "No items were listed for this walk.",
  label: { required_now: "Required Now", recommended: "Recommended" } as Record<string, string>,
  mark: { needs_fixing: "Needs Fixing", fix_planned: "Fix Planned", done: "Done" } as Record<string, string>,
  markedOn: (word: string, iso: string) => `${word} on ${shortDay(iso)}`,
  recheckedOn: (iso: string) => `Rechecked on ${shortDay(iso)}`,
};

const STYLE = [
  'body{margin:0;color:#2d2a22;font:400 10.5pt/1.45 "Atkinson Hyperlegible",system-ui,sans-serif}',
  "main{max-width:6.5in;margin:0 auto;padding:16px}",
  "h1,h2,h3{text-align:center;margin:0 0 8px}",
  "h1{font-size:20pt}h2{font-size:13pt;margin-top:20px;border-top:0.75pt solid #d9d2bd;padding-top:12px}h3{font-size:10.5pt;text-align:left;margin:10px 0 2px}",
  "p{margin:0}.lead,[data-property]{text-align:center;margin-bottom:6px}[data-property]{font-weight:700}ul{margin:0;padding-left:18px}",
  "@media print{main{max-width:none;padding:0}}",
].join("");

const STATUS: Partial<Record<PortfolioErrorCode, number>> = { unauthorized: 401, not_found: 404, method_not_allowed: 405, not_set_up: 503, server_error: 500 };

const fail = (code: PortfolioErrorCode): Response =>
  Response.json({ error: { code, message: code === "not_set_up" ? "The record cannot be printed right now." : code === "unauthorized" ? "Sign in first." : "That does not exist." } }, { status: STATUS[code] ?? 500 });

const capital = (words: string): string => `${words.charAt(0).toUpperCase()}${words.slice(1)}`;

type Line = { at: string; text: string };

const itemHtml = (finding: FindingState, lines: Line[]): string => {
  const concept = CONCEPT_WORDS[finding.concept as Concept] ?? finding.concept;
  const dated = [...lines].sort((a, b) => a.at.localeCompare(b.at)).map((line) => `<li>${esc(line.text)}</li>`);
  return `<div data-item><h3>${esc(capital(concept))}, ${esc(recordWords.label[finding.label] ?? finding.label)}</h3>${dated.length === 0 ? "" : `<ul>${dated.join("")}</ul>`}</div>`;
};

const walkHtml = (walk: PropertyWalkRecord, lines: Map<string, Line[]>): string => {
  const items = walk.findings.filter((f) => !f.vetoed);
  const body =
    walk.state === "failed"
      ? `<p class="lead">${esc(recordWords.notFinished)}</p>`
      : walk.state !== "done"
        ? `<p class="lead">${esc(recordWords.stillChecking)}</p>`
        : items.length === 0
          ? `<p class="lead">${esc(recordWords.noItems)}</p>`
          : items.map((f) => itemHtml(f, lines.get(f.id) ?? [])).join("");
  return `<section data-walk><h2>${esc(recordWords.walked(walkedDay(walk)))}</h2>${body}</section>`;
};

export const recordHtml = (label: string, walks: PropertyWalkRecord[], lines: Map<string, Line[]>): string => {
  const oldestFirst = [...walks].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.walkId.localeCompare(b.walkId));
  const sections = oldestFirst.length === 0 ? `<p class="lead">${esc(recordWords.noWalks)}</p>` : oldestFirst.map((w) => walkHtml(w, lines)).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(recordWords.title)}</title><style>${STYLE}</style></head><body><main><h1>${esc(recordWords.title)}</h1><p data-property>${esc(label)}</p><p class="lead">${esc(report.notInspectionShort)}</p>${sections}</main></body></html>`;
};

const linesOf = async (env: RecordEnv, propertyId: string, walks: PropertyWalkRecord[]): Promise<Map<string, Line[]>> => {
  const lines = new Map<string, Line[]>();
  const add = (findingId: string, line: Line) => lines.set(findingId, [...(lines.get(findingId) ?? []), line]);
  for (const mark of await propertyMarks(env.DB, propertyId)) {
    add(mark.findingId, { at: mark.markedAt, text: recordWords.markedOn(recordWords.mark[mark.status] ?? mark.status, mark.doneOn ?? mark.markedAt.slice(0, 10)) });
  }
  for (const walk of walks) {
    for (const finding of walk.findings.filter((f) => !f.vetoed)) {
      for (const answer of await answersOf(env.MEDIA, { id: finding.id, walkId: finding.walkId })) add(finding.id, { at: answer.createdAt, text: recordWords.recheckedOn(answer.createdAt.slice(0, 10)) });
    }
  }
  return lines;
};

export const handleRecord = async (request: Request, env: RecordEnv, propertyId: string, deps: RecordDeps = {}): Promise<Response> => {
  if (request.method !== "GET") return fail("method_not_allowed");
  try {
    const session = await accountOf(request, env.DB);
    if (session === null) return fail("unauthorized");
    const property = await ownProperty(env.DB, session, propertyId);
    if (property === null) return fail("not_found");
    if (env.BROWSER === undefined) return fail("not_set_up");
    const walks = await propertyWalks(env.DB, propertyId);
    const html = recordHtml(property.label, walks, await linesOf(env, propertyId, walks));
    const bytes = await (deps.print ?? ((browser, page) => pdfOf(browser, page)))(env.BROWSER, html);
    return new Response(bytes, { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="emberwalk-property-record.pdf"', "cache-control": "no-store" } });
  } catch (error) {
    console.warn(`property record failed: ${error instanceof Error ? error.message : String(error)}`);
    return fail("server_error");
  }
};

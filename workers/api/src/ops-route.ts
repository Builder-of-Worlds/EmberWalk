import type { Limits } from "@emberwalk/shared";
import type { AccessConfig } from "./access-jwt.ts";
import { FAILED_SHOWN, type FailedWalk, NOT_CHECKED_SHOWN, type NotCheckedPart, type OpsData, type StepSpend, type StepTiming, WALK_STATES, readOps } from "./ops-data.ts";

export const OPS_PATH = "/ops";
const TOKEN_HEADER = "cf-access-jwt-assertion";

export type OpsDeps = {
  db: D1Database;
  limits: Limits;
  now: () => number;
  verifier: { verify: (token: string | null, config: AccessConfig | null) => Promise<boolean> };
  config: AccessConfig | null;
};

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

const plain = (text: string, status: number, headers: Record<string, string> = {}): Response =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers } });

const esc = (text: string | number): string =>
  String(text).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const usd = (n: number): string => `$${n.toFixed(2)}`;

const rows = (pairs: [string, number][]): string => pairs.map(([name, n]) => `<tr><th scope="row">${esc(name)}</th><td>${esc(n)}</td></tr>`).join("");

const spendTable = (data: OpsData): string => {
  if (data.spendByStep.length === 0) return "<p>No spend today.</p>";
  const body = data.spendByStep.map((s: StepSpend) => `<tr><th scope="row">${esc(s.step)}</th><td>${esc(usd(s.usd))}</td></tr>`).join("");
  return `<table><tbody>${body}</tbody></table>`;
};

const duration = (ms: number): string => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

const timingTable = (data: OpsData): string => {
  if (data.stepTimes.length === 0) return "<p>No step was timed today.</p>";
  const body = data.stepTimes.map((t: StepTiming) => `<tr><th scope="row">${esc(t.step)}</th><td>${esc(duration(t.medianMs))}</td><td>${esc(t.runs)}</td></tr>`).join("");
  return `<table><thead><tr><th>Step</th><th>Median</th><th>Runs</th></tr></thead><tbody>${body}</tbody></table>`;
};

const failedTable = (data: OpsData): string => {
  if (data.failed.length === 0) return "<p>No failed walks today.</p>";
  const body = data.failed
    .map(
      (f: FailedWalk) =>
        `<tr><td class="id">${esc(f.walkId)}</td><td>${esc(f.step)}</td><td>${esc(f.code)}</td><td>${esc(f.message ?? "no message")}</td><td>${esc(f.side ?? "whole walk")}</td></tr>`,
    )
    .join("");
  const more = data.walksByState.failed > FAILED_SHOWN ? `<p>Newest ${FAILED_SHOWN} of ${esc(data.walksByState.failed)}.</p>` : "";
  return `<table><thead><tr><th>Walk</th><th>Step</th><th>Code</th><th>Message</th><th>Part</th></tr></thead><tbody>${body}</tbody></table>${more}`;
};

const notCheckedTable = (data: OpsData): string => {
  if (data.notChecked.length === 0) return "<p>No parts were left not checked today.</p>";
  const body = data.notChecked.map((p: NotCheckedPart) => `<tr><td class="id">${esc(p.walkId)}</td><td>${esc(p.side)}</td></tr>`).join("");
  const more = data.notCheckedParts > NOT_CHECKED_SHOWN ? `<p>Newest ${NOT_CHECKED_SHOWN} of ${esc(data.notCheckedParts)} parts.</p>` : "";
  return `<table><thead><tr><th>Walk</th><th>Side</th></tr></thead><tbody>${body}</tbody></table>${more}`;
};

const STYLE =
  "body{margin:0;padding:16px;font:16px/1.5 system-ui,sans-serif;background:#faf7f2;color:#1c1a17}main{max-width:44rem;margin:0 auto}h1{text-align:center;font-size:1.5rem}h2{font-size:1.1rem;margin:1.5rem 0 .5rem}" +
  "table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{text-align:left;padding:.25rem .5rem;border-bottom:1px solid #d9d2c5;overflow-wrap:anywhere}progress{width:100%;height:1rem}.over{font-weight:700}";

const render = (data: OpsData): string => {
  const state = data.overCap ? `<p class="over">At or over the cap.</p>` : "<p>Under the cap.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>EmberWalk ops</title><style>${STYLE}</style></head><body><main>
<h1>EmberWalk ops</h1><p>Day (UTC): ${esc(data.day)}</p>
<h2>Meta spend today</h2><p>${esc(usd(data.spentUsd))} of ${esc(usd(data.capUsd))} (${esc(data.percent)}%)</p><progress max="100" value="${esc(Math.min(data.percent, 100))}"></progress>${state}
<h2>Spend per step today</h2>${spendTable(data)}
<h2>Time per step today</h2>${timingTable(data)}
<h2>Walks today</h2><table><tbody>${rows(WALK_STATES.map((name) => [name, data.walksByState[name]]))}</tbody></table>
<h2>Failed walks today</h2>${failedTable(data)}
<h2>Parts left not checked today</h2>${notCheckedTable(data)}
<h2>Queue now</h2><table><tbody>${rows([["Waiting", data.queue.queued], ["Running", data.queue.processing]])}</tbody></table>
<h2>Email sends today</h2><table><tbody>${rows([["Sent", data.emails.sentToday], ["Approved, not yet sent", data.emails.approvedWaiting]])}</tbody></table>
</main></body></html>`;
};

export const handleOps = async (request: Request, deps: OpsDeps): Promise<Response> => {
  if (deps.config === null) return plain("The ops page is not set up.", 503);
  if (!(await deps.verifier.verify(request.headers.get(TOKEN_HEADER), deps.config))) return plain("Sign in through Cloudflare Access.", 401);
  if (request.method !== "GET" && request.method !== "HEAD") return plain("Use GET.", 405, { allow: "GET, HEAD" });
  try {
    const data = await readOps(deps.db, new Date(deps.now()).toISOString().slice(0, 10), deps.limits);
    return new Response(request.method === "HEAD" ? null : render(data), { headers: PAGE_HEADERS });
  } catch {
    return plain("The ops page could not read the database.", 500);
  }
};

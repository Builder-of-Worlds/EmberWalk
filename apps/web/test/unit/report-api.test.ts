import { VISITOR_HEADER } from "@emberwalk/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Fetch } from "../../src/api.ts";
import { APPROVAL_TIMEOUT_MS, browserCopy, PAGE_TIMEOUT_MS, PDF_TIMEOUT_MS, REPORT_NAME, reportApi } from "../../src/report-api.ts";

const BASE = "https://ember.test";
const VISITOR = "c".repeat(64);
const WALK = "00000000-0000-4000-8000-0000000a0001";
const GONE = ["00000000-0000-4000-8000-0000000b0001", "00000000-0000-4000-8000-0000000b0002"];
const PAGE = "<!doctype html><html><body><main><h1>Defensible Space Record</h1></main></body></html>";
const SEEN = "x-report-seen";
const DIGEST = "ab".repeat(32);

const refusal = (code: string, status: number) => Response.json({ error: { code, message: "No." } }, { status });

const serving = (answer: (request: Request) => Response | Promise<Response>) => {
  const seen: Request[] = [];
  const send: Fetch = async (request) => {
    seen.push(request);
    return answer(request);
  };
  return { seen, api: reportApi(BASE, send, () => VISITOR, () => undefined, async () => true) };
};

const pdfResponse = (disposition: string, type = "application/pdf", body: BodyInit = "%PDF-1.7 report") =>
  new Response(body, { headers: { "content-type": type, "content-disposition": disposition } });

const breaking = () =>
  new ReadableStream<Uint8Array>({
    start: (controller) => {
      controller.enqueue(new TextEncoder().encode("%PDF-1.7 first bytes"));
      controller.error(new TypeError("network connection was lost"));
    },
  });

const never = (request: Request) =>
  new Promise<Response>((_, reject) => request.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));

afterEach(() => vi.useRealTimers());

describe("the report client", () => {
  it("reads the report page as this visitor, sending the items removed with This Isn't Right, with the server's digest of what it shows", async () => {
    const { seen, api } = serving(() => new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8", [SEEN]: DIGEST } }));
    expect(await api.page(WALK, GONE)).toEqual({ html: PAGE, seen: DIGEST });
    expect(await api.page(WALK, [])).toEqual({ html: PAGE, seen: DIGEST });
    expect([seen[0]!.method, seen[0]!.url, seen[0]!.headers.get(VISITOR_HEADER)]).toEqual(["GET", `${BASE}/api/walks/${WALK}/report?removed=${GONE.join("%2C")}`, VISITOR]);
    expect(seen[1]!.url).toBe(`${BASE}/api/walks/${WALK}/report`);
  });

  it("reads the PDF as this visitor with the same removed items, under the file name the server gives", async () => {
    const { seen, api } = serving(() => pdfResponse('attachment; filename="emberwalk-record-2026-10-28.pdf"'));
    const answer = await api.pdf(WALK, GONE);
    expect(answer.pdf === undefined ? answer.code : answer.name).toBe("emberwalk-record-2026-10-28.pdf");
    expect(await answer.pdf!.text()).toBe("%PDF-1.7 report");
    expect([seen[0]!.url, seen[0]!.headers.get(VISITOR_HEADER)]).toEqual([`${BASE}/api/walks/${WALK}/report.pdf?removed=${GONE.join("%2C")}`, VISITOR]);
  });

  it("asks whether the walk is approved for the report it shows, whether it changed since, and approves it with a POST, each with the removed items", async () => {
    const at = "2026-10-30T16:00:00.000Z";
    const { seen, api } = serving((request) => Response.json(request.method === "POST" ? { approvedAt: at, changed: false } : { approvedAt: null, changed: true }));
    expect(await api.approval(WALK, GONE)).toEqual({ approvedAt: null, changed: true });
    expect(await api.approve(WALK, GONE, DIGEST)).toEqual({ approvedAt: at, changed: false });
    expect(await api.approve(WALK, [], "cd".repeat(32))).toEqual({ approvedAt: at, changed: false });
    expect(seen.map((r) => [r.method, r.url, r.headers.get(VISITOR_HEADER), r.headers.get(SEEN)])).toEqual([
      ["GET", `${BASE}/api/walks/${WALK}/report/approval?removed=${GONE.join("%2C")}`, VISITOR, null],
      ["POST", `${BASE}/api/walks/${WALK}/report/approval?removed=${GONE.join("%2C")}`, VISITOR, DIGEST],
      ["POST", `${BASE}/api/walks/${WALK}/report/approval`, VISITOR, "cd".repeat(32)],
    ]);
    for (const body of [{}, { approvedAt: "yesterday", changed: false }, { approvedAt: 5, changed: false }, { approvedAt: at }, { approvedAt: null, changed: "yes" }]) {
      expect(await serving(() => Response.json(body)).api.approve(WALK, [], DIGEST)).toEqual({ code: "server_error" });
    }
  });

  it("sends the phone's own day with an approval, not the UTC day, when the two differ", async () => {
    const zone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T01:38:00.000Z"));
    try {
      const { seen, api } = serving((request) => Response.json({ approvedAt: request.method === "POST" ? "2026-11-04T01:38:00.000Z" : null, changed: false }));
      await api.approval(WALK, []);
      await api.approve(WALK, [], DIGEST);
      expect(seen.map((r) => r.headers.get("x-report-day"))).toEqual([null, "2026-11-03"]);
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it("refuses a report page that comes without the server's digest of what it shows", async () => {
    for (const digest of [null, "", "AB".repeat(32), "ab".repeat(31), `${"ab".repeat(32)}0`]) {
      const headers: Record<string, string> = { "content-type": "text/html; charset=utf-8", ...(digest === null ? {} : { [SEEN]: digest }) };
      expect(await serving(() => new Response(PAGE, { headers })).api.page(WALK, [])).toEqual({ code: "server_error" });
    }
  });

  it("keeps a plain file name when the server's is missing or not one of its own", async () => {
    for (const disposition of ["", 'attachment; filename="../../evil.exe"']) {
      const { api } = serving(() => pdfResponse(disposition));
      const answer = await api.pdf(WALK, []);
      expect(answer.pdf === undefined ? answer.code : answer.name).toBe(REPORT_NAME);
    }
  });

  it("refuses an answer that is not the kind asked for", async () => {
    expect(await serving(() => new Response("{}", { headers: { "content-type": "application/json" } })).api.page(WALK, [])).toEqual({ code: "server_error" });
    expect(await serving(() => pdfResponse("", "text/html")).api.pdf(WALK, [])).toEqual({ code: "server_error" });
    expect(await serving(() => pdfResponse("", "application/pdf", "")).api.pdf(WALK, [])).toEqual({ code: "server_error" });
  });

  it("names the server's refusal, an unknown code as a server error, and no signal as offline", async () => {
    expect(await serving(() => refusal("walk_not_done", 409)).api.page(WALK, [])).toEqual({ code: "walk_not_done" });
    expect(await serving(() => refusal("conflict", 409)).api.pdf(WALK, [])).toEqual({ code: "conflict" });
    expect(await serving(() => refusal("body_too_large", 413)).api.page(WALK, [])).toEqual({ code: "body_too_large" });
    expect(await serving(() => refusal("unknown_walk", 404)).api.approve(WALK, [], DIGEST)).toEqual({ code: "unknown_walk" });
    expect(await serving(() => refusal("spend_cap_reached", 429)).api.page(WALK, [])).toEqual({ code: "server_error" });
    expect(await serving(() => new Response("oops", { status: 503 })).api.pdf(WALK, [])).toEqual({ code: "server_error" });
    for (const ask of ["page", "pdf", "approval"] as const) {
      expect(await serving(() => Promise.reject(new TypeError("Failed to fetch"))).api[ask](WALK, [])).toEqual({ code: "offline" });
    }
  });

  it("answers offline when the body breaks partway, after its first bytes", async () => {
    expect(await serving(() => new Response(breaking(), { headers: { "content-type": "text/html", [SEEN]: DIGEST } })).api.page(WALK, [])).toEqual({ code: "offline" });
    expect(await serving(() => pdfResponse("", "application/pdf", breaking())).api.pdf(WALK, [])).toEqual({ code: "offline" });
    expect(await serving(() => new Response(breaking(), { headers: { "content-type": "application/json" } })).api.approval(WALK, [])).toEqual({ code: "offline" });
  });

  it("gives up on its own and stops the request when the server takes too long", async () => {
    vi.useFakeTimers();
    for (const [ask, ms] of [
      ["page", PAGE_TIMEOUT_MS],
      ["pdf", PDF_TIMEOUT_MS],
      ["approve", APPROVAL_TIMEOUT_MS],
    ] as const) {
      const { seen, api } = serving(never);
      let answer: unknown = null;
      void (ask === "approve" ? api.approve(WALK, [], DIGEST) : api[ask](WALK, [])).then((a) => (answer = a));
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(answer).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(answer).toEqual({ code: "timeout" });
      expect(seen[0]!.signal.aborted).toBe(true);
    }
    expect([PAGE_TIMEOUT_MS, PDF_TIMEOUT_MS, APPROVAL_TIMEOUT_MS]).toEqual([20_000, 60_000, 15_000]);
  });
});

describe("the share link client", () => {
  const CODE = `${"Ab".repeat(20)}_-c`;
  const PATH = `/api/shared/${CODE}`;
  const at = "2026-10-30T16:00:00.000Z";

  it("reads, makes with the removed items, and turns off this walk's link as this visitor, and gives the whole link on this site", async () => {
    const { seen, api } = serving((request) => Response.json(request.method === "DELETE" ? { path: null, createdAt: null } : { path: PATH, createdAt: at }));
    expect(await api.share(WALK)).toEqual({ link: `${BASE}${PATH}` });
    expect(await api.makeShare(WALK, GONE)).toEqual({ link: `${BASE}${PATH}` });
    expect(await api.stopShare(WALK)).toEqual({ link: null });
    expect(seen.map((r) => [r.method, r.url, r.headers.get(VISITOR_HEADER)])).toEqual([
      ["GET", `${BASE}/api/walks/${WALK}/report/share`, VISITOR],
      ["POST", `${BASE}/api/walks/${WALK}/report/share?removed=${GONE.join("%2C")}`, VISITOR],
      ["DELETE", `${BASE}/api/walks/${WALK}/report/share`, VISITOR],
    ]);
    expect(await serving(() => Response.json({ path: null, createdAt: null })).api.share(WALK)).toEqual({ link: null });
  });

  it("refuses a link that is not one of the server's own share paths", async () => {
    for (const path of ["https://evil.test/api/shared/x", `/api/shared/${CODE}x`, `//evil.test${PATH}`, `/api/walks/${WALK}/report.pdf`, 5]) {
      expect(await serving(() => Response.json({ path, createdAt: at })).api.share(WALK)).toEqual({ code: "server_error" });
    }
    expect(await serving(() => new Response("not json")).api.makeShare(WALK, [])).toEqual({ code: "server_error" });
  });

  it("names the server's refusal and no signal, and gives up on its own", async () => {
    expect(await serving(() => refusal("conflict", 409)).api.makeShare(WALK, [])).toEqual({ code: "conflict" });
    expect(await serving(() => Promise.reject(new TypeError("Failed to fetch"))).api.stopShare(WALK)).toEqual({ code: "offline" });
    vi.useFakeTimers();
    for (const [ask, ms] of [
      ["share", APPROVAL_TIMEOUT_MS],
      ["makeShare", PDF_TIMEOUT_MS],
      ["stopShare", APPROVAL_TIMEOUT_MS],
    ] as const) {
      const { seen, api } = serving(never);
      let answer: unknown = null;
      void api[ask](WALK, []).then((a) => (answer = a));
      await vi.advanceTimersByTimeAsync(ms - 1);
      expect(answer).toBeNull();
      await vi.advanceTimersByTimeAsync(1);
      expect(answer).toEqual({ code: "timeout" });
      expect(seen[0]!.signal.aborted).toBe(true);
    }
  });

  it("copies through the clipboard and says when it could not", async () => {
    const written: string[] = [];
    expect(await browserCopy({ clipboard: { writeText: async (text: string) => void written.push(text) } })("https://ember.test/x")).toBe(true);
    expect(written).toEqual(["https://ember.test/x"]);
    expect(await browserCopy({ clipboard: { writeText: () => Promise.reject(new Error("denied")) } })("x")).toBe(false);
    expect(await browserCopy({})("x")).toBe(false);
  });
});

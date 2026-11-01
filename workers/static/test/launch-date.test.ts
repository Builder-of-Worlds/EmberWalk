import { describe, expect, it } from "vitest";
import { handle } from "../src/handler";
import { deps, fakeMailer, fakeVerify, testEnv } from "./helpers";

const DATE = /Nov(\.|ember)?\s*4(th)?/i;
const SENTENCE = "EmberWalk launches Nov. 4th, 2026.";
const REST = "Take one walk around your house with your phone and see what could catch, what to fix first, and what California requires.";

function get(path: string, flag?: string) {
  const env = flag === undefined ? testEnv() : Object.assign(testEnv(), { LAUNCH_DATE_SHOWN: flag });
  if (flag === undefined) delete (env as { LAUNCH_DATE_SHOWN?: string }).LAUNCH_DATE_SHOWN;
  return handle(new Request(`https://emberwalk.app${path}`), env, deps(fakeVerify(), fakeMailer()));
}

function metas(html: string) {
  return [...html.matchAll(/<meta (?:name|property)="(description|og:description|twitter:description)" content="([^"]*)"/g)].map((m) => [m[1], m[2]]);
}

describe("launch date flag", () => {
  it.each([["off"], ["missing"], ["On"], ["yes"], [""]])("keeps every availability date off the landing page when the flag is %s", async (state) => {
    const response = await get("/", state === "missing" ? undefined : state);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).not.toMatch(DATE);
    expect(html).not.toContain("data-launch-date");
    expect(metas(html)).toEqual([["description", REST], ["og:description", REST], ["twitter:description", REST]]);
    expect(html).toContain("<span>Be first in line.</span>");
    expect(html).toContain('<form id="signup"');
  });

  it("shows the four approved date sentences word for word when the flag is on", async () => {
    const html = await (await get("/", "on")).text();
    const full = `${SENTENCE} ${REST}`;
    expect(metas(html)).toEqual([["description", full], ["og:description", full], ["twitter:description", full]]);
    expect(html).toContain(`<p class="lead"><span>${SENTENCE}</span><span>Be first in line.</span></p>`);
    expect(html).not.toContain("data-launch-date");
  });

  it("names no availability date on any page in the sitemap, or on the missing page, while the flag is off", async () => {
    const sitemap = await (await get("/sitemap.xml", "off")).text();
    const paths = [...sitemap.matchAll(/<loc>https:\/\/emberwalk\.app([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(paths.length).toBeGreaterThanOrEqual(2);
    for (const path of [...paths, "/no-such-page"]) {
      const html = await (await get(path, "off")).text();
      expect(html, path).not.toMatch(DATE);
    }
  });

  it("leaves responses that are not HTML untouched", async () => {
    const response = await get("/robots.txt", "off");
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toContain("Sitemap: https://emberwalk.app/sitemap.xml");
  });

  it.each([
    ["a query string", "/?launch", {}],
    ["a query string naming the flag", "/?LAUNCH_DATE_SHOWN=on&launch=on", {}],
    ["a request header", "/", { "launch-date-shown": "on", "x-launch-date": "on", LAUNCH_DATE_SHOWN: "on" }],
    ["a cookie", "/", { cookie: "LAUNCH_DATE_SHOWN=on; launch=on; launch-date=on" }],
  ])("keeps the date off when %s asks for it while the setting is off", async (_name, path, headers) => {
    const request = new Request(`https://emberwalk.app${path}`, { headers });
    const html = await (await handle(request, testEnv(), deps(fakeVerify(), fakeMailer()))).text();
    expect(html).not.toMatch(DATE);
    expect(metas(html)).toEqual([["description", REST], ["og:description", REST], ["twitter:description", REST]]);
  });

  it.each([["off"], ["on"]])("gives a rewritten page no ETag of its source while the flag is %s, so a cached copy cannot outlive a flip", async (flag) => {
    const page = '<html><head></head><body><p data-launch-date>EmberWalk launches Nov. 4th, 2026.</p></body></html>';
    const assets = { fetch: async () => new Response(page, { headers: { "content-type": "text/html; charset=utf-8", etag: '"source-etag"' } }) };
    const env = testEnv({ LAUNCH_DATE_SHOWN: flag, ASSETS: assets as unknown as Fetcher });
    const response = await handle(new Request("https://emberwalk.app/"), env, deps(fakeVerify(), fakeMailer()));
    expect(response.headers.get("etag")).toBeNull();
    expect(await response.text()).toBe(flag === "on" ? "<html><head></head><body><p>EmberWalk launches Nov. 4th, 2026.</p></body></html>" : "<html><head></head><body></body></html>");
  });

  it("keeps the ETag on responses it does not rewrite", async () => {
    const assets = { fetch: async () => new Response("User-agent: *\n", { headers: { "content-type": "text/plain", etag: '"robots-etag"' } }) };
    const env = testEnv({ ASSETS: assets as unknown as Fetcher });
    const response = await handle(new Request("https://emberwalk.app/robots.txt"), env, deps(fakeVerify(), fakeMailer()));
    expect(response.headers.get("etag")).toBe('"robots-etag"');
  });

  it("serves the real landing page with no ETag", async () => {
    expect((await get("/", "off")).headers.get("etag")).toBeNull();
  });

  it.each([["off"], ["on"]])("serves the real 404 page for a missing path with no ETag while the flag is %s", async (flag) => {
    const response = await get("/no-such-page", flag);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("etag")).toBeNull();
  });

  it.each([[404], [410], [500]])("drops the source ETag from a rewritten page answered with status %i", async (status) => {
    const page = '<html><body><p data-launch-date>EmberWalk launches Nov. 4th, 2026.</p></body></html>';
    const assets = { fetch: async () => new Response(page, { status, headers: { "content-type": "text/html", etag: '"missing-etag"' } }) };
    const response = await handle(new Request("https://emberwalk.app/no-such-page"), testEnv({ ASSETS: assets as unknown as Fetcher }), deps(fakeVerify(), fakeMailer()));
    expect(response.status).toBe(status);
    expect(response.headers.get("etag")).toBeNull();
  });

  it("is off in the deployed settings", () => {
    expect((testEnv() as { LAUNCH_DATE_SHOWN?: string }).LAUNCH_DATE_SHOWN).toBe("off");
  });
});

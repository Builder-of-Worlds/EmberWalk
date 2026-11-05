import { describe, expect, it } from "vitest";
import { answer, partOf } from "../src/index.ts";

const FILE = new Uint8Array(1000).map((_, i) => i % 256);

const env = { ASSETS: { fetch: async () => new Response(FILE, { headers: { "content-type": "video/mp4" } }) } };

const ask = (range?: string, method = "GET") => new Request("https://judges.test/walk.mp4", { method, headers: range === undefined ? {} : { range } });

describe("the videos' range answers", () => {
  it("reads the three range forms and refuses what is outside the file", () => {
    expect(partOf("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
    expect(partOf("bytes=900-", 1000)).toEqual({ start: 900, end: 999 });
    expect(partOf("bytes=-10", 1000)).toEqual({ start: 990, end: 999 });
    expect(partOf("bytes=2000-", 1000)).toBeNull();
    expect(partOf("bytes=-", 1000)).toBeNull();
    expect(partOf("rows=1-2", 1000)).toBeNull();
  });

  it("streams a range instead of reading the whole file into memory", async () => {
    let pulls = 0;
    const big = 25 * 1024 * 1024;
    const streaming = {
      ASSETS: {
        fetch: async () =>
          new Response(
            new ReadableStream({
              pull: (c) => {
                pulls += 1;
                c.enqueue(new Uint8Array(1000).fill(7));
              },
            }),
            { headers: { "content-length": String(big), etag: '"a"' } },
          ),
      },
    };
    const part = await answer(ask("bytes=10-19"), streaming);
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 10-19/${big}`);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(new Uint8Array(10).fill(7));
    expect(pulls, "it stops reading once the range is done").toBeLessThan(4);
  });

  it("passes If-None-Match on and keeps cross-origin reading on the 304", async () => {
    let sent: string | null = null;
    const unchanged = {
      ASSETS: {
        fetch: async (request: Request) => {
          sent = request.headers.get("if-none-match");
          return new Response(null, { status: 304, headers: { etag: '"a"' } });
        },
      },
    };
    const reply = await answer(new Request("https://judges.test/film/0/seg000.m4s", { headers: { "if-none-match": '"a"', range: "bytes=0-1" } }), unchanged);
    expect(sent).toBe('"a"');
    expect(reply.status).toBe(304);
    expect(reply.headers.get("access-control-allow-origin")).toBe("https://emberwalk.app");
  });

  it("names the playlist and segment types that Safari's own player insists on", async () => {
    const type = async (file: string) => (await answer(new Request(`https://judges.test/walk/desktop/${file}`), env)).headers.get("content-type");
    expect(await type("master.m3u8")).toBe("application/vnd.apple.mpegurl");
    expect(await type("0/seg000.m4s")).toBe("video/iso.segment");
  });

  it("answers a range with exactly those bytes", async () => {
    const part = await answer(ask("bytes=100-199"), env);
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(part.headers.get("content-type")).toBe("video/mp4");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(FILE.slice(100, 200));
  });

  it("answers no range with the whole file and says ranges work", async () => {
    const whole = await answer(ask(), env);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect((await whole.arrayBuffer()).byteLength).toBe(1000);
  });

  it("answers an impossible range with 416", async () => {
    const refused = await answer(ask("bytes=5000-"), env);
    expect(refused.status).toBe(416);
    expect(refused.headers.get("content-range")).toBe("bytes */1000");
  });

  it("lets only the landing site read the files across origins", async () => {
    expect((await answer(ask(), env)).headers.get("access-control-allow-origin")).toBe("https://emberwalk.app");
  });

  it("passes a missing file straight through", async () => {
    const missing = await answer(ask(), { ASSETS: { fetch: async () => new Response(null, { status: 404 }) } });
    expect(missing.status).toBe(404);
  });
});

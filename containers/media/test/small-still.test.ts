import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer } from "./support/fixture-server.ts";
import type { FixtureServer } from "./support/fixture-server.ts";
import { clipWithSound, grayPixels, jpegSize } from "./support/fixtures.ts";
import { freePort, spawnServer, waitForHealth } from "./support/server-process.ts";

const spread = (gray: Buffer): number => {
  let sum = 0;
  for (const v of gray) sum += v;
  const mean = sum / gray.length;
  let squares = 0;
  for (const v of gray) squares += (v - mean) ** 2;
  return Math.sqrt(squares / gray.length);
};

describe("a small report copy of each still", () => {
  let fixtures: FixtureServer;
  let baseUrl: string;
  let stop: () => void;
  const out = (name: string) => `http://127.0.0.1:${fixtures.port}/out/${name}`;
  const put = (name: string) => fixtures.puts.get(`/out/${name}`) as Buffer;

  beforeAll(async () => {
    fixtures = await startFixtureServer();
    const port = await freePort();
    const child = spawnServer(port);
    stop = () => child.kill("SIGKILL");
    baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl);
    fixtures.files.set("/wide.mp4", clipWithSound(2, 1920, 1080));
    fixtures.files.set("/tall.mp4", clipWithSound(2, 1080, 1920));
    for (const [clip, name] of [["wide", "wide"], ["tall", "tall"]]) {
      const res = await fetch(`${baseUrl}/stills`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: `http://127.0.0.1:${fixtures.port}/${clip}.mp4`,
          stills: [
            { time: 0.5, output: out(`${name}.jpg`), small: out(`${name}.small.jpg`) },
            { time: 0.5, output: out(`${name}-hidden.jpg`), small: out(`${name}-hidden.small.jpg`), regions: [[0, 0, 1, 1]] },
            { time: 0.5, output: out(`${name}-alone.jpg`) },
          ],
        }),
      });
      expect(res.status).toBe(200);
    }
  });

  afterAll(async () => {
    stop?.();
    await fixtures?.close();
  });

  it("writes the full still unchanged and a copy whose longest side is 1000 pixels, in the same shape", () => {
    expect(jpegSize(put("wide.jpg"))).toEqual({ width: 1920, height: 1080 });
    expect(jpegSize(put("wide.small.jpg"))).toEqual({ width: 1000, height: 562 });
    expect(jpegSize(put("tall.jpg"))).toEqual({ width: 1080, height: 1920 });
    expect(jpegSize(put("tall.small.jpg"))).toEqual({ width: 562, height: 1000 });
  });

  it("makes the copy smaller than the full still", () => {
    for (const name of ["wide", "tall"]) expect(put(`${name}.small.jpg`).length).toBeLessThan(put(`${name}.jpg`).length);
  });

  it("makes the copy from the blurred still, never the frame before the blur", () => {
    expect(spread(grayPixels(put("wide-hidden.small.jpg")))).toBeLessThan(spread(grayPixels(put("wide.small.jpg"))) / 2);
  });

  it("writes no copy when none is asked for", () => {
    expect(fixtures.puts.has("/out/wide-alone.jpg")).toBe(true);
    expect([...fixtures.puts.keys()].filter((k) => k.includes("alone.small"))).toEqual([]);
  });
});

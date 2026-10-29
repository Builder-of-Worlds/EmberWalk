import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boxOf, clipOfDigits, edgeEnergy, FRAME, meanAbsDiffInBand, ownCorrelations, readDigits, regionAround } from "./support/digits.ts";
import { startFixtureServer } from "./support/fixture-server.ts";
import type { FixtureServer } from "./support/fixture-server.ts";
import { grayPixels, jpegSize } from "./support/fixtures.ts";
import { freePort, spawnServer, waitForHealth } from "./support/server-process.ts";

const NUMBER = "4827";
const MARGIN = 3;
const box = boxOf(NUMBER.length);

describe("blurring a tight house number box", () => {
  let fixtures: FixtureServer;
  let baseUrl: string;
  let stop: () => void;
  let plain: Buffer;
  let blurred: Buffer;

  beforeAll(async () => {
    fixtures = await startFixtureServer();
    const port = await freePort();
    const child = spawnServer(port);
    stop = () => child.kill("SIGKILL");
    baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl);
    fixtures.files.set("/number.mp4", clipOfDigits(NUMBER, box, MARGIN + 1));
    const res = await fetch(`${baseUrl}/stills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: `http://127.0.0.1:${fixtures.port}/number.mp4`,
        stills: [
          { time: 0.5, output: `http://127.0.0.1:${fixtures.port}/out/plain.jpg` },
          { time: 0.5, output: `http://127.0.0.1:${fixtures.port}/out/blurred.jpg`, regions: [regionAround(box, MARGIN)] },
        ],
      }),
    });
    expect(res.status).toBe(200);
    plain = fixtures.puts.get("/out/plain.jpg") as Buffer;
    blurred = fixtures.puts.get("/out/blurred.jpg") as Buffer;
  });

  afterAll(async () => {
    stop?.();
    await fixtures?.close();
  });

  it("measures the digits as readable and sharp on the still that was not blurred", () => {
    expect(jpegSize(plain)).toEqual({ width: FRAME.width, height: FRAME.height });
    const pixels = grayPixels(plain);
    expect(readDigits(pixels, box, NUMBER.length)).toBe(NUMBER);
    for (const r of ownCorrelations(pixels, box, NUMBER)) expect(r).toBeGreaterThan(0.99);
    expect(edgeEnergy(pixels, box)).toBeGreaterThan(10);
  });

  it("leaves every digit unlike its own shape and the box flat after the blur", () => {
    const before = grayPixels(plain);
    const after = grayPixels(blurred);
    for (const r of ownCorrelations(after, box, NUMBER)) expect(r).toBeLessThan(0.6);
    expect(edgeEnergy(after, box)).toBeLessThan(edgeEnergy(before, box) / 4);
  });

  it("does not spread the blur past the margin around the box", () => {
    const band = meanAbsDiffInBand(grayPixels(plain), grayPixels(blurred), box, MARGIN + 1, MARGIN + 13);
    expect(band).toBeLessThan(0.3);
  });
});

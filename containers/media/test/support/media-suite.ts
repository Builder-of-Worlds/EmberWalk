import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixtureServer } from "./fixture-server.ts";
import type { FixtureServer } from "./fixture-server.ts";
import { clipWithoutPicture, clipWithSound, clipWithoutSound, grayPixels, jpegSize, readWav } from "./fixtures.ts";

export type Target = {
  baseUrl: string;
  fixtureHost: string;
  stop: () => Promise<void>;
};

export interface Json {
  [key: string]: Json;
}

type Reply = { status: number; json: Json; headers: Headers };

export const mediaSuite = (label: string, start: () => Promise<Target>): void => {
  describe(label, () => {
    let target: Target;
    let fixtures: FixtureServer;
    let withSound: Buffer;
    let withoutSound: Buffer;

    const url = (path: string): string => `http://${target.fixtureHost}:${fixtures.port}${path}`;
    const serve = (path: string, bytes: Buffer): string => {
      fixtures.files.set(path, bytes);
      return url(path);
    };
    const call = async (path: string, body: unknown, method = "POST"): Promise<Reply> => {
      const res = await fetch(`${target.baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json()) as Json, headers: res.headers };
    };

    beforeAll(async () => {
      fixtures = await startFixtureServer();
      target = await start();
      withSound = clipWithSound(10);
      withoutSound = clipWithoutSound(6);
      serve("/with-sound.mp4", withSound);
      serve("/silent.mp4", withoutSound);
      serve("/garbage.mp4", Buffer.from("this is not a video file at all"));
    }, 600_000);

    afterAll(async () => {
      await target?.stop();
      await fixtures?.close();
    });

    describe("health and routing", () => {
      it("reports ffmpeg is ready", async () => {
        const reply = await call("/health", null, "GET");
        expect(reply.status).toBe(200);
        expect(reply.json.status).toBe("ok");
        expect(reply.json.ffmpeg).toMatch(/^ffmpeg version/);
      });

      it("refuses an unknown operation", async () => {
        const reply = await call("/nope", {});
        expect(reply.status).toBe(404);
        expect(reply.json.error.code).toBe("not_found");
      });

      it("refuses the wrong method", async () => {
        expect((await call("/clip", null, "GET")).status).toBe(405);
        expect((await call("/health", {})).status).toBe(405);
      });

      it("refuses a body that is not JSON", async () => {
        const reply = await call("/probe", "{not json");
        expect(reply.status).toBe(400);
        expect(reply.json.error.code).toBe("invalid_json");
      });

      it("refuses a body that is too large", async () => {
        const reply = await call("/probe", { input: "http://x/" + "a".repeat(70_000) });
        expect(reply.status).toBe(413);
        expect(reply.json.error.code).toBe("body_too_large");
      });
    });

    describe("probe", () => {
      it("reports duration, size, rate and sound of a valid MP4", async () => {
        const reply = await call("/probe", { input: url("/with-sound.mp4") });
        expect(reply.status).toBe(200);
        expect(reply.json.isMp4).toBe(true);
        expect(reply.json.durationSeconds).toBeCloseTo(10, 1);
        expect(reply.json.video).toMatchObject({ codec: "h264", width: 640, height: 360 });
        expect(reply.json.video.fps).toBeCloseTo(30, 1);
        expect(reply.json.audio.codec).toBe("aac");
        expect(reply.json.bytes).toBe(withSound.length);
      });

      it("reports a clip with no sound", async () => {
        const reply = await call("/probe", { input: url("/silent.mp4") });
        expect(reply.json.audio).toBeNull();
        expect(reply.json.durationSeconds).toBeCloseTo(6, 1);
      });

      it("refuses bytes that are not media", async () => {
        const reply = await call("/probe", { input: url("/garbage.mp4") });
        expect(reply.status).toBe(422);
        expect(reply.json.error.code).toBe("invalid_media");
      });

      it("reports an input that cannot be fetched", async () => {
        const reply = await call("/probe", { input: url("/missing.mp4") });
        expect(reply.status).toBe(502);
        expect(reply.json.error.code).toBe("input_unavailable");
      });

      it("refuses inputs that are not http or https URLs, or have extra fields", async () => {
        for (const input of ["file:///etc/passwd", "ftp://host/x", "not a url", "", 5, null]) {
          const reply = await call("/probe", { input });
          expect(reply.status).toBe(400);
          expect(reply.json.error.code).toBe("invalid_url");
        }
        const extra = await call("/probe", { input: url("/with-sound.mp4"), shell: "ls" });
        expect(extra.json.error.code).toBe("unknown_field");
        expect((await call("/probe", [1])).json.error.code).toBe("invalid_body");
      });
    });

    describe("clip at a set frame rate", () => {
      it("cuts 10 seconds at 2 frames per second into 20 H.264 frames with no sound", async () => {
        const reply = await call("/clip", { input: url("/with-sound.mp4"), output: url("/out/clip.mp4"), fps: 2 });
        expect(reply.status).toBe(200);
        expect(reply.json.frames).toBe(20);
        expect(reply.json.durationSeconds).toBeCloseTo(10, 0);
        expect(reply.json).toMatchObject({ fps: 2, width: 640, height: 360 });
        const stored = fixtures.puts.get("/out/clip.mp4");
        expect(stored?.length).toBe(reply.json.bytes);
        serve("/check-clip.mp4", stored as Buffer);
        const check = await call("/probe", { input: url("/check-clip.mp4") });
        expect(check.json.video.codec).toBe("h264");
        expect(check.json.video.fps).toBeCloseTo(2, 1);
        expect(check.json.audio).toBeNull();
      });

      it("defaults to 2 frames per second", async () => {
        const reply = await call("/clip", { input: url("/silent.mp4"), output: url("/out/default.mp4") });
        expect(reply.json.fps).toBe(2);
        expect(reply.json.frames).toBe(12);
      });

      it("cuts only the asked range", async () => {
        const reply = await call("/clip", { input: url("/with-sound.mp4"), output: url("/out/range.mp4"), start: 2, end: 6, fps: 2 });
        expect(reply.json.frames).toBe(8);
        expect(reply.json.durationSeconds).toBeCloseTo(4, 0);
      });

      it("accepts the highest allowed rate and an end past the media", async () => {
        const reply = await call("/clip", { input: url("/silent.mp4"), output: url("/out/fast.mp4"), fps: 4, end: 400 });
        expect(reply.status).toBe(200);
        expect(reply.json.frames).toBe(24);
      });

      it("scales down to a maximum height, never up", async () => {
        const down = await call("/clip", { input: url("/with-sound.mp4"), output: url("/out/small.mp4"), maxHeight: 180 });
        expect(down.json.height).toBe(180);
        expect(down.json.width).toBe(320);
        const same = await call("/clip", { input: url("/with-sound.mp4"), output: url("/out/same.mp4"), maxHeight: 720 });
        expect(same.json.height).toBe(360);
      });

      it("refuses a rate above 4 frames per second, however it is asked", async () => {
        for (const fps of [4.01, 5, 30, 1000]) {
          const reply = await call("/clip", { input: url("/silent.mp4"), output: url("/out/x.mp4"), fps });
          expect(reply.status).toBe(400);
          expect(reply.json.error.code).toBe("fps_too_high");
        }
        expect(fixtures.puts.has("/out/x.mp4")).toBe(false);
      });

      it("refuses a rate that is zero, negative or not a number", async () => {
        for (const fps of [0, -1, "2", null, Number.NaN]) {
          const reply = await call("/clip", { input: url("/silent.mp4"), output: url("/out/x.mp4"), fps });
          expect(reply.status).toBe(400);
          expect(reply.json.error.code).toBe("invalid_fps");
        }
      });

      it("refuses bad ranges and heights", async () => {
        const base = { input: url("/silent.mp4"), output: url("/out/x.mp4") };
        expect((await call("/clip", { ...base, start: 5, end: 5 })).json.error.code).toBe("invalid_range");
        expect((await call("/clip", { ...base, start: 5, end: 2 })).json.error.code).toBe("invalid_range");
        expect((await call("/clip", { ...base, start: -1 })).json.error.code).toBe("invalid_time");
        expect((await call("/clip", { ...base, end: 100000 })).json.error.code).toBe("invalid_time");
        expect((await call("/clip", { ...base, maxHeight: 4 })).json.error.code).toBe("invalid_height");
        expect((await call("/clip", { ...base, maxHeight: 99999 })).json.error.code).toBe("invalid_height");
        expect((await call("/clip", { ...base, maxHeight: 100.5 })).json.error.code).toBe("invalid_height");
      });

      it("refuses a start at the exact end of the media", async () => {
        const probed = await call("/probe", { input: url("/silent.mp4") });
        const reply = await call("/clip", { input: url("/silent.mp4"), output: url("/out/x.mp4"), start: probed.json.durationSeconds });
        expect(reply.status).toBe(422);
        expect(reply.json.error.code).toBe("range_outside_media");
      });

      it("refuses a start past the end of the media", async () => {
        const reply = await call("/clip", { input: url("/silent.mp4"), output: url("/out/x.mp4"), start: 60 });
        expect(reply.status).toBe(422);
        expect(reply.json.error.code).toBe("range_outside_media");
      });

      it("refuses a missing output and garbage input", async () => {
        expect((await call("/clip", { input: url("/silent.mp4") })).json.error.code).toBe("invalid_url");
        const bad = await call("/clip", { input: url("/garbage.mp4"), output: url("/out/x.mp4") });
        expect(bad.status).toBe(422);
      });

      it("reports a result that cannot be stored", async () => {
        fixtures.failPuts.add("/out/fail.mp4");
        const reply = await call("/clip", { input: url("/silent.mp4"), output: url("/out/fail.mp4") });
        expect(reply.status).toBe(502);
        expect(reply.json.error.code).toBe("output_failed");
      });
    });

    describe("audio to WAV", () => {
      it("writes 16 kHz mono 16 bit PCM of the full length", async () => {
        const reply = await call("/audio", { input: url("/with-sound.mp4"), output: url("/out/audio.wav") });
        expect(reply.status).toBe(200);
        expect(reply.json).toMatchObject({ sampleRate: 16000, channels: 1 });
        const wav = readWav(fixtures.puts.get("/out/audio.wav") as Buffer);
        expect(wav).toMatchObject({ format: 1, channels: 1, sampleRate: 16000, bits: 16 });
        expect(wav.seconds).toBeCloseTo(10, 1);
        expect(reply.json.bytes).toBe(fixtures.puts.get("/out/audio.wav")?.length);
      });

      it("cuts only the asked range", async () => {
        await call("/audio", { input: url("/with-sound.mp4"), output: url("/out/part.wav"), start: 1, end: 4 });
        const wav = readWav(fixtures.puts.get("/out/part.wav") as Buffer);
        expect(wav.seconds).toBeCloseTo(3, 1);
      });

      it("refuses a start at the exact end of the media", async () => {
        const probed = await call("/probe", { input: url("/with-sound.mp4") });
        const reply = await call("/audio", { input: url("/with-sound.mp4"), output: url("/out/x.wav"), start: probed.json.durationSeconds });
        expect(reply.json.error.code).toBe("range_outside_media");
      });

      it("refuses a video with no sound", async () => {
        const reply = await call("/audio", { input: url("/silent.mp4"), output: url("/out/none.wav") });
        expect(reply.status).toBe(422);
        expect(reply.json.error.code).toBe("no_audio");
        expect(fixtures.puts.has("/out/none.wav")).toBe(false);
      });

      it("refuses bad ranges, a start past the end, and garbage", async () => {
        const base = { input: url("/with-sound.mp4"), output: url("/out/x.wav") };
        expect((await call("/audio", { ...base, start: 4, end: 1 })).json.error.code).toBe("invalid_range");
        expect((await call("/audio", { ...base, start: 99 })).json.error.code).toBe("range_outside_media");
        expect((await call("/audio", { ...base, fps: 2 })).json.error.code).toBe("unknown_field");
        expect((await call("/audio", { input: url("/garbage.mp4"), output: url("/out/x.wav") })).status).toBe(422);
      });
    });

    describe("stills", () => {
      it("writes one full resolution JPEG per time", async () => {
        const times = [1, 5, 9.5];
        const reply = await call("/stills", {
          input: url("/with-sound.mp4"),
          stills: times.map((time, i) => ({ time, output: url(`/out/still-${i}.jpg`) })),
        });
        expect(reply.status).toBe(200);
        expect(reply.json.stills).toHaveLength(3);
        times.forEach((time, i) => {
          const jpeg = fixtures.puts.get(`/out/still-${i}.jpg`) as Buffer;
          expect(jpeg.subarray(0, 2).toString("hex")).toBe("ffd8");
          expect(jpegSize(jpeg)).toEqual({ width: 640, height: 360 });
          expect(reply.json.stills[i]).toMatchObject({ time, width: 640, height: 360, bytes: jpeg.length });
        });
      });

      it("keeps the full resolution of a larger video", async () => {
        serve("/big.mp4", clipWithSound(2, 1920, 1080));
        await call("/stills", { input: url("/big.mp4"), stills: [{ time: 1, output: url("/out/big.jpg") }] });
        expect(jpegSize(fixtures.puts.get("/out/big.jpg") as Buffer)).toEqual({ width: 1920, height: 1080 });
      });

      it("shows different frames at different times", async () => {
        await call("/stills", {
          input: url("/with-sound.mp4"),
          stills: [{ time: 1, output: url("/out/a.jpg") }, { time: 8, output: url("/out/b.jpg") }],
        });
        expect(fixtures.puts.get("/out/a.jpg")?.equals(fixtures.puts.get("/out/b.jpg") as Buffer)).toBe(false);
      });

      it("refuses a time past the end of the media and stores nothing", async () => {
        const reply = await call("/stills", {
          input: url("/with-sound.mp4"),
          stills: [{ time: 1, output: url("/out/late-0.jpg") }, { time: 10.5, output: url("/out/late-1.jpg") }],
        });
        expect(reply.status).toBe(422);
        expect(reply.json.error.code).toBe("time_out_of_range");
        expect(fixtures.puts.has("/out/late-0.jpg")).toBe(false);
      });

      it("refuses a time at the exact end of the media", async () => {
        const probed = await call("/probe", { input: url("/with-sound.mp4") });
        const reply = await call("/stills", {
          input: url("/with-sound.mp4"),
          stills: [{ time: probed.json.durationSeconds, output: url("/out/end.jpg") }],
        });
        expect(reply.json.error.code).toBe("time_out_of_range");
      });

      it("refuses empty lists, too many stills, negative times and bad fields", async () => {
        const input = url("/with-sound.mp4");
        const still = (i: number) => ({ time: 1, output: url(`/out/many-${i}.jpg`) });
        expect((await call("/stills", { input, stills: [] })).json.error.code).toBe("invalid_stills");
        expect((await call("/stills", { input })).json.error.code).toBe("invalid_stills");
        const sixty = await call("/stills", { input, stills: Array.from({ length: 61 }, (_, i) => still(i)) });
        expect(sixty.status).toBe(400);
        expect(sixty.json.error.code).toBe("too_many_stills");
        expect((await call("/stills", { input, stills: [{ time: -1, output: url("/o.jpg") }] })).json.error.code).toBe("invalid_time");
        expect((await call("/stills", { input, stills: [{ time: 1 }] })).json.error.code).toBe("invalid_url");
        expect((await call("/stills", { input, stills: [{ time: 1, output: url("/o.jpg"), x: 1 }] })).json.error.code).toBe("unknown_field");
        expect((await call("/stills", { input, stills: ["x"] })).json.error.code).toBe("invalid_body");
      });

      it("accepts exactly 60 stills", async () => {
        const stills = Array.from({ length: 60 }, (_, i) => ({ time: (i % 5) + 0.5, output: url(`/out/sixty-${i}.jpg`) }));
        const reply = await call("/stills", { input: url("/silent.mp4"), stills });
        expect(reply.status).toBe(200);
        expect(reply.json.stills).toHaveLength(60);
      }, 120_000);
    });

    describe("stills with regions to blur", () => {
      const WIDTH = 640;
      const HEIGHT = 360;
      const MARGIN = 16;

      const meanAbsDiff = (a: Buffer, b: Buffer, within: (x: number, y: number) => boolean): number => {
        let total = 0;
        let count = 0;
        for (let y = 0; y < HEIGHT; y += 1) {
          for (let x = 0; x < WIDTH; x += 1) {
            if (!within(x, y)) continue;
            total += Math.abs((a[y * WIDTH + x] as number) - (b[y * WIDTH + x] as number));
            count += 1;
          }
        }
        return total / count;
      };

      const sharpest = (pixels: Buffer, within: (x: number, y: number) => boolean): number => {
        let top = 0;
        for (let y = 0; y < HEIGHT; y += 1) {
          for (let x = 1; x < WIDTH; x += 1) {
            if (!within(x, y) || !within(x - 1, y)) continue;
            top = Math.max(top, Math.abs((pixels[y * WIDTH + x] as number) - (pixels[y * WIDTH + x - 1] as number)));
          }
        }
        return top;
      };

      const inside = (x0: number, y0: number, x1: number, y1: number, pad = 0) => (x: number, y: number) =>
        x >= x0 - pad && x < x1 + pad && y >= y0 - pad && y < y1 + pad;

      const stillsOf = async (regions: unknown[][] | undefined, extra: Record<string, unknown> = {}) => {
        const reply = await call("/stills", {
          input: url("/with-sound.mp4"),
          stills: [
            { time: 1, output: url("/out/plain.jpg") },
            { time: 1, output: url("/out/blurred.jpg"), ...(regions === undefined ? {} : { regions }), ...extra },
          ],
        });
        return {
          reply,
          plain: fixtures.puts.get("/out/plain.jpg") as Buffer,
          blurred: fixtures.puts.get("/out/blurred.jpg") as Buffer,
        };
      };

      it("blurs the named region so its detail is gone, and leaves the rest of the still as it was", async () => {
        const { reply, plain, blurred } = await stillsOf([[0.25, 0.25, 0.5, 0.5]]);
        expect(reply.status).toBe(200);
        expect(jpegSize(blurred)).toEqual({ width: WIDTH, height: HEIGHT });
        const region = inside(160, 90, 320, 180);
        const a = grayPixels(plain);
        const b = grayPixels(blurred);
        expect(meanAbsDiff(a, b, region)).toBeGreaterThan(6);
        const core = inside(163, 93, 317, 177);
        expect(sharpest(a, core)).toBeGreaterThan(50);
        expect(sharpest(b, core)).toBeLessThan(sharpest(a, core) / 3);
        expect(meanAbsDiff(a, b, (x, y) => !inside(160, 90, 320, 180, MARGIN)(x, y))).toBeLessThan(1);
      });

      it("blurs every region it is given", async () => {
        const { plain, blurred } = await stillsOf([[0.1, 0.1, 0.3, 0.3], [0.6, 0.6, 0.9, 0.9]]);
        const a = grayPixels(plain);
        const b = grayPixels(blurred);
        expect(meanAbsDiff(a, b, inside(64, 36, 192, 108))).toBeGreaterThan(4);
        expect(meanAbsDiff(a, b, inside(384, 216, 576, 324))).toBeGreaterThan(4);
        expect(meanAbsDiff(a, b, inside(240, 130, 340, 200))).toBeLessThan(1);
      });

      it("blurs a region that reaches the edge of the frame", async () => {
        const { reply, plain, blurred } = await stillsOf([[0.75, 0.75, 1, 1]]);
        expect(reply.status).toBe(200);
        expect(meanAbsDiff(grayPixels(plain), grayPixels(blurred), inside(480, 270, 640, 360))).toBeGreaterThan(4);
      });

      it("makes a still with no regions exactly as one without the field", async () => {
        const { reply, plain, blurred } = await stillsOf([]);
        expect(reply.status).toBe(200);
        expect(blurred.equals(plain)).toBe(true);
      });

      it("accepts exactly 32 regions", async () => {
        const regions = Array.from({ length: 32 }, (_, i) => [(i % 8) / 10, Math.floor(i / 8) / 10, (i % 8) / 10 + 0.05, Math.floor(i / 8) / 10 + 0.05]);
        expect((await stillsOf(regions)).reply.status).toBe(200);
      }, 120_000);

      it("refuses a region that is not four numbers from 0 to 1 with the first corner above and left of the second", async () => {
        const cases: [unknown, string][] = [
          [[[0.1, 0.1, 0.5]], "invalid_region"],
          [[[0.1, 0.1, 0.5, 0.5, 0.6]], "invalid_region"],
          [[["a", 0.1, 0.5, 0.5]], "invalid_region"],
          [[[0.1, 0.1, null, 0.5]], "invalid_region"],
          [["x"], "invalid_region"],
          [{ x0: 0 }, "invalid_region"],
          [[[-0.1, 0.1, 0.5, 0.5]], "region_out_of_range"],
          [[[0.1, 0.1, 1.01, 0.5]], "region_out_of_range"],
          [[[0.1, 0.1, 0.5, Number.MAX_VALUE]], "region_out_of_range"],
          [[[0.5, 0.1, 0.5, 0.5]], "region_inverted"],
          [[[0.6, 0.1, 0.5, 0.5]], "region_inverted"],
          [[[0.1, 0.5, 0.5, 0.2]], "region_inverted"],
          [Array.from({ length: 33 }, () => [0.1, 0.1, 0.2, 0.2]), "too_many_regions"],
        ];
        for (const [regions, code] of cases) {
          const reply = await call("/stills", { input: url("/with-sound.mp4"), stills: [{ time: 1, output: url("/out/bad-region.jpg"), regions }] });
          expect([JSON.stringify(regions).slice(0, 60), reply.status, reply.json.error.code]).toEqual([JSON.stringify(regions).slice(0, 60), 400, code]);
        }
        expect(fixtures.puts.has("/out/bad-region.jpg")).toBe(false);
      });

      it("refuses an unknown field next to the regions", async () => {
        const reply = await call("/stills", {
          input: url("/with-sound.mp4"),
          stills: [{ time: 1, output: url("/out/extra.jpg"), regions: [[0.1, 0.1, 0.2, 0.2]], radius: 4 }],
        });
        expect(reply.json.error.code).toBe("unknown_field");
      });

      it("refuses an input with no picture, and stores nothing", async () => {
        serve("/sound-only.mp4", clipWithoutPicture(3));
        const reply = await call("/stills", {
          input: url("/sound-only.mp4"),
          stills: [{ time: 1, output: url("/out/nopic.jpg"), regions: [[0.1, 0.1, 0.2, 0.2]] }],
        });
        expect(reply.status).toBe(422);
        expect(reply.json.error.code).toBe("no_video");
        expect(fixtures.puts.has("/out/nopic.jpg")).toBe(false);
      });

      it("refuses a time past the end when regions are named, and stores nothing", async () => {
        const reply = await call("/stills", {
          input: url("/with-sound.mp4"),
          stills: [
            { time: 1, output: url("/out/region-late-0.jpg"), regions: [[0.1, 0.1, 0.2, 0.2]] },
            { time: 10.5, output: url("/out/region-late-1.jpg"), regions: [[0.1, 0.1, 0.2, 0.2]] },
          ],
        });
        expect(reply.status).toBe(422);
        expect(reply.json.error.code).toBe("time_out_of_range");
        expect(fixtures.puts.has("/out/region-late-0.jpg")).toBe(false);
        expect(fixtures.puts.has("/out/region-late-1.jpg")).toBe(false);
      });
    });

    describe("load", () => {
      it("refuses a second job while one is running, then recovers", async () => {
        fixtures.delays.set("/with-sound.mp4", 1500);
        const fetching = fixtures.requested("/with-sound.mp4");
        const first = call("/probe", { input: url("/with-sound.mp4") });
        try {
          await fetching;
          const second = await call("/probe", { input: url("/silent.mp4") });
          expect(second.status).toBe(503);
          expect(second.json.error.code).toBe("busy");
          expect(second.headers.get("retry-after")).toBe("5");
          expect((await first).status).toBe(200);
        } finally {
          await first.catch(() => undefined);
          fixtures.delays.delete("/with-sound.mp4");
        }
        expect((await call("/probe", { input: url("/silent.mp4") })).status).toBe(200);
      });
    });

    describe("walk render", () => {
      const renders = process.env.EMBERWALK_RENDERS ?? join(homedir(), "emberwalk-renders");
      const walk = join(renders, "test-yard", "walk.mp4");
      const source = existsSync(walk) ? "the synthetic yard render" : "a clip made by the test";

      it(`cuts frames and stills from ${source}`, async () => {
        const bytes = existsSync(walk) ? readFileSync(walk) : clipWithSound(8, 1280, 720);
        serve("/yard.mp4", bytes);
        const info = await call("/probe", { input: url("/yard.mp4") });
        expect(info.json.isMp4).toBe(true);
        const clip = await call("/clip", { input: url("/yard.mp4"), output: url("/out/yard.mp4"), fps: 2 });
        expect(clip.json.frames).toBe(Math.round(info.json.durationSeconds * 2));
        const still = await call("/stills", { input: url("/yard.mp4"), stills: [{ time: 0.5, output: url("/out/yard.jpg") }] });
        expect(still.json.stills[0].width).toBe(info.json.video.width);
        expect(still.json.stills[0].height).toBe(info.json.video.height);
      }, 300_000);
    });
  });
};

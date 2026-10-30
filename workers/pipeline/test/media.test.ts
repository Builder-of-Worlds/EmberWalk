import { describe, expect, it } from "vitest";
import { containerMedia } from "../src/media.ts";

type Seen = { url: string; body: unknown };

const container = (status: number, body: string) => {
  const seen: Seen[] = [];
  const fetcher = {
    fetch: async (url: string, init: { body: string }) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return new Response(body, { status });
    },
  } as unknown as Fetcher;
  return { media: containerMedia(fetcher), seen };
};

const PROBE = { bytes: 10, durationSeconds: 30, isMp4: true };
const CLIP = { bytes: 5, frames: 60, fps: 2, codec: "h264", durationSeconds: 30, width: 320, height: 568 };
const REQUEST = { input: "https://r2.test/in", output: "https://r2.test/out", start: 0, end: 30, fps: 2, maxHeight: 720 };

describe("containerMedia", () => {
  it("asks the container to probe and to cut, and reads the answers", async () => {
    const probe = container(200, JSON.stringify(PROBE));
    expect(await probe.media.probe("https://r2.test/in")).toEqual({ ok: true, value: PROBE });
    expect(probe.seen).toEqual([{ url: "http://media/probe", body: { input: "https://r2.test/in" } }]);

    const cut = container(200, JSON.stringify(CLIP));
    expect(await cut.media.clip(REQUEST)).toEqual({ ok: true, value: CLIP });
    expect(cut.seen).toEqual([{ url: "http://media/clip", body: REQUEST }]);
  });

  it("asks the container for stills with their regions, and reads the answer", async () => {
    const stills = { input: "https://r2.test/in", stills: [{ time: 1.5, output: "https://r2.test/out", regions: [[0.1, 0.1, 0.4, 0.4] as [number, number, number, number]] }] };
    const made = { stills: [{ time: 1.5, bytes: 900, width: 320, height: 568 }] };
    const { media, seen } = container(200, JSON.stringify(made));

    expect(await media.stills(stills)).toEqual({ ok: true, value: made });
    expect(seen).toEqual([{ url: "http://media/stills", body: stills }]);
  });

  it("turns a refused stills request into a refusal and throws on a container error", async () => {
    const request = { input: "https://r2.test/in", stills: [] };
    const refused = container(422, JSON.stringify({ error: { code: "time_out_of_range", message: "Past the end." } }));
    expect(await refused.media.stills(request)).toEqual({ ok: false, failure: { code: "media_time_out_of_range", message: "Past the end." } });

    await expect(container(500, "busy").media.stills(request)).rejects.toThrow("500");
  });

  it.each([400, 404, 405, 413, 422])("turns a %i answer into a refusal that carries the container's reason", async (status) => {
    const { media } = container(status, JSON.stringify({ error: { code: "not_a_video", message: "That file is not a video." } }));

    expect(await media.probe("https://r2.test/in")).toEqual({
      ok: false,
      failure: { code: "media_not_a_video", message: "That file is not a video." },
    });
  });

  it("refuses with a plain reason when the container gives none", async () => {
    const { media } = container(422, "<html>no</html>");

    expect(await media.clip(REQUEST)).toMatchObject({ ok: false, failure: { code: "media_refused" } });
  });

  it.each([500, 503])("throws on a %i answer so the step retries", async (status) => {
    const { media } = container(status, "busy");

    await expect(media.probe("https://r2.test/in")).rejects.toThrow(String(status));
  });

  it("throws on a 200 that does not have the promised shape", async () => {
    await expect(container(200, JSON.stringify({ bytes: "many" })).media.probe("https://r2.test/in")).rejects.toThrow();
    await expect(container(200, "not json").media.clip(REQUEST)).rejects.toThrow();
  });

  it.each(["hevc", "vp9", null])("throws on a clip the container made as %s, so no clip phones cannot play is saved", async (codec) => {
    await expect(container(200, JSON.stringify({ ...CLIP, codec })).media.clip(REQUEST)).rejects.toThrow();
    const noCodec = Object.fromEntries(Object.entries(CLIP).filter(([key]) => key !== "codec"));
    await expect(container(200, JSON.stringify(noCodec)).media.clip(REQUEST)).rejects.toThrow();
  });
});

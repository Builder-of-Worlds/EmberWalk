import { getWalk } from "@emberwalk/db";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { depsFrom } from "../src/deps.ts";
import type { Env } from "../src/env.ts";
import { containerMedia } from "../src/media.ts";
import { dropWalkVideo, originalKey, soundKey, turnsKey } from "../src/storage.ts";
import { readTurns, transcribeWalk } from "../src/transcribe.ts";
import { freshWalkId, resetAll, seedOriginal, seedWalk } from "./fixtures.ts";
import { harness, testDeps } from "./harness.ts";

beforeEach(resetAll);

const deps = () => testDeps(env, harness);

const walk = async (options: { synthetic?: boolean } = {}): Promise<string> => {
  const walkId = freshWalkId();
  await seedWalk(walkId, { state: "processing", ...options });
  await seedOriginal(walkId);
  return walkId;
};

const asked = () => harness.requests.filter((r) => r.path === "/asr/transcribe");

const transcribeRows = async () =>
  (await env.DB.prepare("SELECT units_kind, units_count FROM cost_records WHERE step = 'transcribe'").all<{ units_kind: string; units_count: number }>()).results;

describe("the media audio call", () => {
  const container = (status: number, body: string) => {
    const seen: { url: string; body: unknown }[] = [];
    const fetcher = {
      fetch: async (url: string, init: { body: string }) => {
        seen.push({ url, body: JSON.parse(init.body) });
        return new Response(body, { status });
      },
    } as unknown as Fetcher;
    return { media: containerMedia(fetcher), seen };
  };
  const REQUEST = { input: "https://r2.test/in", output: "https://r2.test/out", start: 0, end: 360 };

  it("asks the container for the sound and reads the answer", async () => {
    const made = { bytes: 640044, sampleRate: 16000, channels: 1, durationSeconds: 20 };
    const { media, seen } = container(200, JSON.stringify(made));
    expect(await media.audio(REQUEST)).toEqual({ ok: true, value: made });
    expect(seen).toEqual([{ url: "http://media/audio", body: REQUEST }]);
  });

  it("reads a walk with no sound as a refusal", async () => {
    const { media } = container(422, JSON.stringify({ error: { code: "no_audio", message: "The input has no sound." } }));
    expect(await media.audio(REQUEST)).toEqual({ ok: false, failure: { code: "media_no_audio", message: "The input has no sound." } });
  });

  it("throws on an answer off its shape", async () => {
    const { media } = container(200, JSON.stringify({ bytes: 1 }));
    await expect(media.audio(REQUEST)).rejects.toThrow();
  });
});

describe("transcribeWalk", () => {
  it("does nothing with the flag off: no audio call and no Meta call", async () => {
    const walkId = await walk();
    expect(await transcribeWalk(deps(), walkId)).toEqual({ turns: 0 });
    expect(harness.audioed).toHaveLength(0);
    expect(harness.requests).toHaveLength(0);
    expect((await getWalk(env.DB, walkId))?.state).toMatchObject({ step: "prepare" });
  });

  it("with the flag on cuts the walk's sound, keeps only the turns under originals/ and books whole seconds", async () => {
    harness.voiceNotes = true;
    const walkId = await walk();
    expect(await transcribeWalk(deps(), walkId)).toEqual({ turns: 3 });
    expect(harness.audioed).toHaveLength(1);
    expect(harness.audioed[0]?.input).toContain(originalKey(walkId));
    expect(harness.audioed[0]?.output).toContain(soundKey(walkId));
    expect(asked()).toHaveLength(1);
    expect(await env.MEDIA.head(soundKey(walkId))).toBeNull();
    const turns = await readTurns(env.MEDIA, walkId);
    expect(turns.map((t) => t.start)).toEqual([1.2, 8.1, 16.8]);
    expect(turns[1]?.text).toBe("The juniper by the porch has a lot of dead branches inside.");
    expect(turnsKey(walkId).startsWith(`originals/${walkId}/`)).toBe(true);
    expect((await getWalk(env.DB, walkId))?.state).toMatchObject({ step: "transcribe" });
    expect(await transcribeRows()).toEqual([{ units_kind: "seconds", units_count: 20 }]);
  });

  it("returns zero turns for an answer off its shape, and keeps no file", async () => {
    harness.voiceNotes = true;
    harness.transcribed = { turns: [{ startMs: 5, endMs: 1, transcript: "x" }] };
    const walkId = await walk();
    expect(await transcribeWalk(deps(), walkId)).toEqual({ turns: 0 });
    expect(await env.MEDIA.head(turnsKey(walkId))).toBeNull();
    expect(await env.MEDIA.head(soundKey(walkId))).toBeNull();
  });

  it("returns zero turns for a silent walk and keeps no file", async () => {
    harness.voiceNotes = true;
    harness.transcribed = { turns: [] };
    const walkId = await walk();
    expect(await transcribeWalk(deps(), walkId)).toEqual({ turns: 0 });
    expect(await env.MEDIA.head(turnsKey(walkId))).toBeNull();
  });

  it("makes no Meta call for a walk recorded with sound off", async () => {
    harness.voiceNotes = true;
    harness.audio = { refuse: { code: "media_no_audio", message: "The input has no sound." } };
    const walkId = await walk();
    expect(await transcribeWalk(deps(), walkId)).toEqual({ turns: 0 });
    expect(asked()).toHaveLength(0);
  });

  it("returns zero turns when the media container fails", async () => {
    harness.voiceNotes = true;
    harness.audio = { throws: "the media container answered 503" };
    const walkId = await walk();
    expect(await transcribeWalk(deps(), walkId)).toEqual({ turns: 0 });
    expect(asked()).toHaveLength(0);
  });

  it("makes no audio or Meta call for real content on free credits", async () => {
    harness.voiceNotes = true;
    const walkId = await walk({ synthetic: false });
    expect(await transcribeWalk(deps(), walkId)).toEqual({ turns: 0 });
    expect(harness.audioed).toHaveLength(0);
    expect(asked()).toHaveLength(0);
  });

  it("throws for a walk that does not exist", async () => {
    harness.voiceNotes = true;
    await expect(transcribeWalk(deps(), freshWalkId())).rejects.toThrow(/missing/);
  });
});

describe("the VOICE_NOTES flag", () => {
  it("is on only for exactly on", () => {
    const flag = (value: string | undefined) => {
      const base = env as unknown as Env;
      expect(base.VOICE_NOTES).toBeUndefined();
      return depsFrom(value === undefined ? base : { ...base, VOICE_NOTES: value }).voiceNotes;
    };
    expect(flag("on")).toBe(true);
    expect([flag("off"), flag(undefined), flag("ON"), flag("yes")]).toEqual([false, false, false, false]);
  });
});

describe("readTurns", () => {
  it("reads no turns from a missing or broken file", async () => {
    const walkId = freshWalkId();
    expect(await readTurns(env.MEDIA, walkId)).toEqual([]);
    await env.MEDIA.put(turnsKey(walkId), JSON.stringify([{ start: 1, text: "" }]));
    expect(await readTurns(env.MEDIA, walkId)).toEqual([]);
  });
});

describe("dropWalkVideo", () => {
  it("deletes the walk's sound and turns with its video, and nothing of another walk", async () => {
    const [walkId, other] = [freshWalkId(), freshWalkId()];
    const keys = (id: string) => [originalKey(id), soundKey(id), turnsKey(id)];
    for (const key of [...keys(walkId), ...keys(other)]) await env.MEDIA.put(key, "x");
    await dropWalkVideo(env.MEDIA, walkId);
    const left = await Promise.all([...keys(walkId), ...keys(other)].map(async (key) => ((await env.MEDIA.head(key)) === null ? null : key)));
    expect(left.filter((key) => key !== null)).toEqual(keys(other));
  });
});

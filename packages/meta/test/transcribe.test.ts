import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MetaHttpError, MetaRefused } from "../src/errors.ts";
import { PRICE_NANO_USD, TRANSCRIBE_MODEL, isStandardModel } from "../src/prices.ts";
import { sparkCall } from "../src/spark.ts";
import { MAX_WAV_BYTES, readWav, transcribe, transcribeCall } from "../src/transcribe.ts";
import type { HttpRequest } from "../src/transport.ts";
import { ok, setup } from "./support.ts";

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../fixtures/meta/transcribe.json");
const answer = JSON.parse(readFileSync(FIXTURE, "utf8")) as { turns: unknown[] };

type WavSpec = { rate?: number; channels?: number; bits?: number; format?: number; seconds?: number; declaredSeconds?: number; riff?: string };

function wav(s: WavSpec = {}): Uint8Array {
  const rate = s.rate ?? 16000;
  const channels = s.channels ?? 1;
  const bits = s.bits ?? 16;
  const blockAlign = (channels * bits) / 8;
  const dataBytes = Math.round((s.seconds ?? 1) * rate) * blockAlign;
  const declared = s.declaredSeconds === undefined ? dataBytes : Math.round(s.declaredSeconds * rate) * blockAlign;
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const tag = (at: number, t: string) => [...t].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, s.riff ?? "RIFF");
  v.setUint32(4, 36 + declared, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, s.format ?? 1, true);
  v.setUint16(22, channels, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bits, true);
  tag(36, "data");
  v.setUint32(40, declared, true);
  for (let i = 44; i + 1 < out.length; i += 2) v.setInt16(i, Math.round(8000 * Math.sin((i - 44) / 20)), true);
  return out;
}

const fault = async (p: Promise<unknown> | (() => unknown)) => {
  let err: unknown = null;
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(MetaRefused);
  return { reason: (err as MetaRefused).reason, message: (err as MetaRefused).message };
};

const req = (o: Partial<Parameters<typeof transcribe>[1]> = {}) => ({ wav: wav({ seconds: 2.7 }), walkId: null, content: "synthetic" as const, language: "en" as const, ...o });

async function requestPart(r: HttpRequest): Promise<Record<string, unknown>> {
  if (!("form" in r)) throw new Error("not a form");
  const part = r.form.get("request");
  if (!(part instanceof Blob)) throw new Error("no request part");
  return JSON.parse(await part.text()) as Record<string, unknown>;
}

describe("readWav", () => {
  it("reads a 16 kHz and a 24 kHz mono 16 bit WAV", () => {
    expect(readWav(wav({ rate: 16000, seconds: 2.5 }))).toEqual({ sampleRate: 16000, channels: 1, bitsPerSample: 16, seconds: 2.5 });
    expect(readWav(wav({ rate: 24000, seconds: 1 }))).toEqual({ sampleRate: 24000, channels: 1, bitsPerSample: 16, seconds: 1 });
  });

  it.each([
    ["stereo", wav({ channels: 2 }), /not_mono/],
    ["8 bit", wav({ bits: 8 }), /not_16_bit/],
    ["44.1 kHz", wav({ rate: 44100 }), /bad_rate/],
    ["not RIFF", wav({ riff: "RIFX" }), /not_wav/],
    ["not PCM", wav({ format: 3 }), /not_pcm/],
    ["empty", new Uint8Array(0), /not_wav/],
    ["no audio frames", wav({ seconds: 0 }), /no_audio/],
    ["over 600 seconds by header", wav({ seconds: 0.1, declaredSeconds: 601 }), /too_long/],
    ["a data chunk shorter than its header says", wav({ seconds: 1, declaredSeconds: 2 }), /truncated/],
  ])("refuses %s as invalid_audio", async (_name, bytes, why) => {
    const f = await fault(() => readWav(bytes));
    expect(f.reason).toBe("invalid_audio");
    expect(f.message).toMatch(why);
  });

  it("refuses a file over 32 MB before reading it", async () => {
    const f = await fault(() => readWav(new Uint8Array(MAX_WAV_BYTES + 1)));
    expect(f.message).toMatch(/too_large/);
  });
});

describe("transcribe", () => {
  it("names Transcribe a Standard mode model priced per second", () => {
    expect(isStandardModel(TRANSCRIBE_MODEL)).toBe(true);
    expect(PRICE_NANO_USD.transcribeSecond).toBe(50_000);
  });

  it("sends the WAV once as a form and reads the turns in time order", async () => {
    const { client, transport, ledger } = setup({ answer: () => ok(answer) });
    const out = await transcribe(client, req({ walkId: "00000000-0000-4000-8000-0000000000aa" }));
    expect(transport.requests).toHaveLength(1);
    const sent = transport.requests[0] as HttpRequest;
    expect(sent.path).toBe("/asr/transcribe");
    expect(await requestPart(sent)).toEqual({ model: TRANSCRIBE_MODEL, mode: "ENDPOINTING", audioEncoding: "WAV", languageBias: ["English"] });
    const audio = "form" in sent ? sent.form.get("audio") : null;
    expect(audio).toBeInstanceOf(Blob);
    expect(new Uint8Array(await (audio as Blob).arrayBuffer())).toEqual(req().wav);
    expect(out.cached).toBe(false);
    expect(out.value.length).toBeGreaterThan(1);
    expect(out.value.map((t) => t.start)).toEqual([...out.value.map((t) => t.start)].sort((a, b) => a - b));
    for (const t of out.value) {
      expect(t.end).toBeGreaterThanOrEqual(t.start);
      expect(t.text).toBe(t.text.trim());
      expect(t.text).not.toBe("");
    }
    expect(ledger.entries.map((e) => [e.step, e.units.kind, e.units.count, e.model, e.walkId])).toEqual([
      ["transcribe", "seconds", 2, TRANSCRIBE_MODEL, "00000000-0000-4000-8000-0000000000aa"],
    ]);
    expect(out.costUsd).toBeCloseTo(2 * 0.00005, 10);
  });

  it("books whole seconds rounded down for a 24 kHz WAV", async () => {
    const { client, ledger } = setup({ answer: () => ok(answer) });
    await transcribe(client, req({ wav: wav({ rate: 24000, seconds: 3.99 }) }));
    expect(ledger.entries[0]?.units.count).toBe(3);
  });

  it("asks for Spanish on a Spanish walk", async () => {
    const { client, transport } = setup({ answer: () => ok(answer) });
    await transcribe(client, req({ language: "es" }));
    expect((await requestPart(transport.requests[0] as HttpRequest))["languageBias"]).toEqual(["Spanish"]);
  });

  it("answers the same WAV from the cache and books nothing, and sends a different WAV", async () => {
    const { client, transport, ledger } = setup({ answer: () => ok(answer) });
    const first = await transcribe(client, req());
    const again = await transcribe(client, req());
    expect(again).toMatchObject({ cached: true, costUsd: 0, fingerprint: first.fingerprint });
    expect(transport.requests).toHaveLength(1);
    expect(ledger.entries.map((e) => e.totalUsd)).toEqual([first.costUsd, 0]);
    const other = await transcribe(client, req({ wav: wav({ seconds: 2.7, rate: 24000 }) }));
    expect(other.cached).toBe(false);
    expect(other.fingerprint).not.toBe(first.fingerprint);
    expect(transport.requests).toHaveLength(2);
  });

  it("drops empty turns and trims words", async () => {
    const { client } = setup({
      answer: () => ok({ turns: [{ turnId: 2, startMs: 3000, endMs: 3500, transcript: "  " }, { turnId: 1, startMs: 1000, endMs: 2000, transcript: "  the woodpile  " }] }),
    });
    expect((await transcribe(client, req())).value).toEqual([{ start: 1, end: 2, text: "the woodpile" }]);
  });

  it.each([
    ["stereo", wav({ channels: 2 })],
    ["8 bit", wav({ bits: 8 })],
    ["44.1 kHz", wav({ rate: 44100 })],
    ["not WAV", new TextEncoder().encode("hello, not a wav file at all, padded past forty four bytes")],
    ["empty", new Uint8Array(0)],
    ["over 600 seconds by header", wav({ seconds: 0.1, declaredSeconds: 601 })],
  ])("refuses a %s file with no transport call", async (_name, bytes) => {
    const { client, transport, ledger } = setup({ answer: () => ok(answer) });
    expect((await fault(transcribe(client, req({ wav: bytes })))).reason).toBe("invalid_audio");
    expect(transport.requests).toHaveLength(0);
    expect(ledger.entries).toHaveLength(0);
  });

  it.each([
    ["no turns list", { transcript: "words" }],
    ["a turn that ends before it starts", { turns: [{ turnId: 1, startMs: 2000, endMs: 1000, transcript: "x" }] }],
    ["a negative time", { turns: [{ turnId: 1, startMs: -1, endMs: 1000, transcript: "x" }] }],
    ["words that are not text", { turns: [{ turnId: 1, startMs: 0, endMs: 1000, transcript: 7 }] }],
  ])("refuses an answer with %s as invalid_answer", async (_name, body) => {
    const { client } = setup({ answer: () => ok(body) });
    expect((await fault(transcribe(client, req()))).reason).toBe("invalid_answer");
  });

  it("refuses real content on free credits before sending", async () => {
    const { client, transport } = setup({ answer: () => ok(answer) });
    expect((await fault(transcribe(client, req({ content: "real" })))).reason).toBe("real_content_on_free_credits");
    expect(transport.requests).toHaveLength(0);
  });

  it("sends real content on a paid run", async () => {
    const { client, transport } = setup({ answer: () => ok(answer), billing: "paid" });
    await transcribe(client, req({ content: "real" }));
    expect(transport.requests).toHaveLength(1);
  });

  it("refuses when the daily cap would be passed, before sending", async () => {
    const { client, transport } = setup({ answer: () => ok(answer), capUsd: 0.00001 });
    expect((await fault(transcribe(client, req())))).toMatchObject({ reason: "daily_cap_reached" });
    expect(transport.requests).toHaveLength(0);
  });

  it("surfaces a 429 with its wait, books nothing, and the retry is sent and booked once", async () => {
    let calls = 0;
    const { client, transport, ledger } = setup({
      answer: () => (++calls === 1 ? { status: 429, retryAfter: "3", text: "slow down" } : ok(answer)),
    });
    const err = await transcribe(client, req()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MetaHttpError);
    expect(err).toMatchObject({ status: 429, retryAfterSeconds: 3 });
    expect(ledger.entries).toHaveLength(0);
    const retried = await transcribe(client, req());
    expect(retried.cached).toBe(false);
    expect(transport.requests).toHaveLength(2);
    expect(ledger.entries).toHaveLength(1);
  });

  it("builds the call without sending anything", () => {
    const call = transcribeCall(req({ walkId: null }));
    expect(call).toMatchObject({ model: TRANSCRIBE_MODEL, step: "transcribe", estimateNano: 2 * 50_000 });
  });
});

describe("JSON fingerprints", () => {
  it("keeps an existing Muse Spark fingerprint byte for byte", async () => {
    const { client } = setup({ answer: () => ok({ status: "completed", output: [] }) });
    const call = sparkCall({ instructions: "Say ok.", input: "ok", content: "synthetic", inputTokenEstimate: 10, maxOutputTokens: 16 }, () => 1);
    const recordedBody = { model: "muse-spark-1.3", store: false, instructions: "Say ok.", input: "ok", max_output_tokens: 16 };
    const out = await client.call({ ...call, request: { method: "POST", path: "/responses", json: recordedBody }, read: () => 1 });
    expect(out.fingerprint).toBe("e61cc1e95b3649b16376d5d8094585cb83f36587ce2d0b91da100b02d855aa5e");
  });
});

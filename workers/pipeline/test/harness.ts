import { d1Ledger } from "@emberwalk/db";
import { type FindingAnswer, ruleTable } from "@emberwalk/explain";
import { type Billing, type HttpRequest, type HttpResponse, MetaClient, type Transport } from "@emberwalk/meta";
import { limitsWith } from "@emberwalk/shared";
import catalogYard from "../../../fixtures/catalog/yard-objects/answers.json";
import transcribeAnswer from "../../../fixtures/meta/transcribe.json";
import { type Deps, r2Cache } from "../src/deps.ts";
import type { Env } from "../src/env.ts";
import type { AudioRequest, ClipRequest, Media, StillsRequest } from "../src/media.ts";
import { type Outcome, pass, refuse } from "../src/outcome.ts";
import { r2Signer } from "../src/storage.ts";

export const FRAME_WIDTH = 320;
export const FRAME_HEIGHT = 334;

const MASK = "!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(";

export type Failure = { code: string; message: string };

export type Sighting = {
  frame: number;
  id: number;
  box: [number, number, number, number];
  confidence?: number;
  frameSize?: [number, number];
};

export type Reply = { found: Sighting[] } | { text: string } | { status: number; retryAfter?: string };

export type Harness = {
  probe: { bytes: number; durationSeconds: number; isMp4: boolean } | { refuse: Failure } | { throws: string };
  clip: { frames: number; fps: number; width: number; height: number } | { refuse: Failure } | { throws: string };
  stills: { width: number; height: number } | { refuse: Failure } | { throws: string };
  probeFailures: number;
  hideDetections: boolean;
  failDeletes: number;
  failPointDeletes: number;
  probed: string[];
  clipped: ClipRequest[];
  stilled: StillsRequest[];
  audio: { seconds: number } | { refuse: Failure } | { throws: string };
  audioed: AudioRequest[];
  transcribed: unknown;
  voiceNotes: boolean;
  answers: Record<string, Reply[]>;
  requests: HttpRequest[];
  asked: string[];
  uploads: number;
  billing: Billing;
  capUsd: number;
  sleeps: number[];
  ids: number;
  steps: string[];
};

export const freshHarness = (): Harness => ({
  probe: { bytes: 4_000_000, durationSeconds: 120, isMp4: true },
  clip: { frames: 60, fps: 2, width: FRAME_WIDTH, height: FRAME_HEIGHT },
  stills: { width: FRAME_WIDTH, height: FRAME_HEIGHT },
  probeFailures: 0,
  hideDetections: false,
  failDeletes: 0,
  failPointDeletes: 0,
  probed: [],
  clipped: [],
  stilled: [],
  audio: { seconds: 20 },
  audioed: [],
  transcribed: transcribeAnswer,
  voiceNotes: false,
  answers: {},
  requests: [],
  asked: [],
  uploads: 0,
  billing: "free_credits",
  capUsd: 20,
  sleeps: [],
  ids: 0,
  steps: [],
});

export const harness: Harness = freshHarness();

export const resetHarness = (): void => {
  Object.assign(harness, freshHarness());
};

export const stageExplain = (findings: FindingAnswer[]): void => {
  harness.answers[ruleTable("ca")] = [{ text: JSON.stringify({ findings }) }];
};

export const SAME_PLACE_PHRASE = "Photo one, then photo two.";

export const stageSamePlace = (answer: { same: boolean; confidence: number } | string): void => {
  harness.answers[SAME_PLACE_PHRASE] = [{ text: typeof answer === "string" ? answer : JSON.stringify(answer) }];
};

export const stageCatalogYard =(h: Harness): void => {
  for (const [phrase, sightings] of Object.entries(catalogYard.sam)) h.answers[phrase] = [{ found: sightings as Sighting[] }];
};

export const idFor = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const record = (s: Sighting): string => {
  const [x1, y1, x2, y2] = s.box;
  const c = s.confidence === undefined ? "" : `;c=${s.confidence}`;
  const [w, h] = s.frameSize ?? [FRAME_WIDTH, FRAME_HEIGHT];
  return `${s.id}<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=${w};h=${h}${c}|><|mask;x=0;y=0;data=27,60,~${MASK}|>`;
};

export const samText = (sightings: Sighting[]): string => {
  const frames = [...new Set(sightings.map((s) => s.frame))].sort((a, b) => a - b);
  return frames.map((f) => `<${f}f>${sightings.filter((s) => s.frame === f).map(record).join(",")}`).join("\n");
};

const completed = (text: string): HttpResponse => ({
  status: 200,
  retryAfter: null,
  text: JSON.stringify({
    id: "resp_1",
    object: "response",
    status: "completed",
    output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
    usage: {},
  }),
});

const json = (status: number, body: unknown): HttpResponse => ({ status, retryAfter: null, text: JSON.stringify(body) });

const nextReply = (h: Harness, phrase: string): Reply => {
  const queue = h.answers[phrase];
  if (queue === undefined || queue.length === 0) return { text: "" };
  return queue.length > 1 ? (queue.shift() as Reply) : (queue[0] as Reply);
};

const phraseOf = (body: unknown): string => {
  const input = (body as { input: { content: { text: string }[] }[] }).input;
  return input[0]?.content[0]?.text ?? "";
};

const POINT_STILL = /\/point\/(\d+)\.jpg/;
const LOOK_STILL = /\/look\/\d+\.jpg/;
const NOTHING_POINTED = '{"found": false, "box": null}';

const placeholderJpeg = (key: string): Uint8Array => new Uint8Array([0xff, 0xd8, ...new TextEncoder().encode(key), 0xff, 0xd9]);

const lookFrameOf = (body: unknown): number | null => {
  const url = (body as { input: { content: { image_url?: string }[] }[] }).input[0]?.content[1]?.image_url;
  if (url === undefined) return null;
  const match = POINT_STILL.exec(atob(url.slice(url.indexOf(",") + 1)));
  return match === null ? null : Number(match[1]);
};

export const fakeTransport =
  (h: Harness): Transport =>
  async (req) => {
    h.requests.push(req);
    if (req.method === "POST" && req.path === "/files") return json(200, { id: `file-${++h.uploads}` });
    if (req.method === "DELETE") return json(200, {});
    if (req.method === "POST" && req.path === "/asr/transcribe") return json(200, h.transcribed);
    if (req.method === "POST" && req.path === "/responses" && "json" in req) {
      const phrase = phraseOf(req.json);
      h.asked.push(phrase);
      const look = lookFrameOf(req.json);
      const key = look !== null && `${phrase}#${look}` in h.answers ? `${phrase}#${look}` : phrase;
      const reply = look !== null && h.answers[key] === undefined ? { text: NOTHING_POINTED } : nextReply(h, key);
      if ("status" in reply) {
        return { status: reply.status, retryAfter: reply.retryAfter ?? null, text: JSON.stringify({ error: "scripted" }) };
      }
      return completed("found" in reply ? samText(reply.found) : reply.text);
    }
    return json(404, {});
  };

export const fakeMedia = (env: Pick<Env, "MEDIA" | "R2_BUCKET_NAME">, h: Harness): Media => {
  const keyOf = (url: string): string => new URL(url).pathname.slice(`/${env.R2_BUCKET_NAME}/`.length);
  return {
    async probe(input): Promise<Outcome<{ bytes: number; durationSeconds: number; isMp4: boolean }>> {
      h.probed.push(input);
      if (h.probeFailures > 0) {
        h.probeFailures--;
        throw new Error("the media container answered 503");
      }
      if ("throws" in h.probe) throw new Error(h.probe.throws);
      if ("refuse" in h.probe) return refuse(h.probe.refuse.code, h.probe.refuse.message);
      return pass(h.probe);
    },
    async clip(request) {
      h.clipped.push(request);
      if ("throws" in h.clip) throw new Error(h.clip.throws);
      if ("refuse" in h.clip) return refuse(h.clip.refuse.code, h.clip.refuse.message);
      const bytes = new Uint8Array(16);
      await env.MEDIA.put(keyOf(request.output), bytes);
      return pass({ ...h.clip, bytes: bytes.length, durationSeconds: request.end - request.start });
    },
    async stills(request) {
      h.stilled.push(request);
      if ("throws" in h.stills) throw new Error(h.stills.throws);
      if ("refuse" in h.stills) return refuse(h.stills.refuse.code, h.stills.refuse.message);
      const { width, height } = h.stills;
      const made = [];
      for (const still of request.stills) {
        const key = keyOf(still.output);
        const bytes = POINT_STILL.test(key) ? placeholderJpeg(key) : new Uint8Array(16);
        await env.MEDIA.put(key, bytes);
        made.push({ time: still.time, bytes: bytes.length, width, height });
      }
      return pass({ stills: made });
    },
    async audio(request) {
      h.audioed.push(request);
      if ("throws" in h.audio) throw new Error(h.audio.throws);
      if ("refuse" in h.audio) return refuse(h.audio.refuse.code, h.audio.refuse.message);
      const bytes = monoWav(h.audio.seconds);
      await env.MEDIA.put(keyOf(request.output), bytes);
      return pass({ bytes: bytes.length, sampleRate: 16000, channels: 1, durationSeconds: h.audio.seconds });
    },
  };
};

export const monoWav = (seconds: number, rate = 16000): Uint8Array => {
  const data = Math.round(seconds * rate) * 2;
  const out = new Uint8Array(44 + data);
  const v = new DataView(out.buffer);
  const tag = (at: number, t: string) => [...t].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + data, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, data, true);
  return out;
};

const FIXED_NOW = new Date("2026-10-26T18:00:00.000Z");

const withoutDetections = (bucket: R2Bucket): R2Bucket =>
  ({
    get: async (key: string) => (key.endsWith("/detections.json") ? null : bucket.get(key)),
    put: (...args: Parameters<R2Bucket["put"]>) => bucket.put(...args),
    delete: (keys: string | string[]) => bucket.delete(keys),
  }) as unknown as R2Bucket;

const failingDeletes = (bucket: R2Bucket, h: Harness): R2Bucket =>
  ({
    get: (key: string) => bucket.get(key),
    put: (...args: Parameters<R2Bucket["put"]>) => bucket.put(...args),
    delete: async (keys: string | string[]) => {
      const pointOnly = [keys].flat().every((key) => POINT_STILL.test(key) || LOOK_STILL.test(key));
      if (pointOnly && h.failPointDeletes > 0) {
        h.failPointDeletes--;
        throw new Error("R2 answered 503");
      }
      if (!pointOnly && h.failDeletes > 0) {
        h.failDeletes--;
        throw new Error("R2 answered 503");
      }
      return bucket.delete(keys);
    },
  }) as unknown as R2Bucket;

export const testDeps = (env: Env, h: Harness): Deps => ({
  db: env.DB,
  bucket: h.failDeletes > 0 || h.failPointDeletes > 0 ? failingDeletes(env.MEDIA, h) : h.hideDetections ? withoutDetections(env.MEDIA) : env.MEDIA,
  media: fakeMedia(env, h),
  signer: r2Signer(env, () => FIXED_NOW),
  meta: () =>
    new MetaClient({
      transport: fakeTransport(h),
      cache: r2Cache(env.DB, env.MEDIA, () => FIXED_NOW),
      ledger: d1Ledger(env.DB),
      billing: h.billing,
      limits: limitsWith({ dailySpendUsd: h.capUsd }),
      now: () => FIXED_NOW,
    }),
  sleep: async (ms) => {
    h.sleeps.push(ms);
  },
  newId: () => idFor(++h.ids),
  voiceNotes: h.voiceNotes,
});

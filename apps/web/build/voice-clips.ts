import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { RULES } from "@emberwalk/rules";
import testYard from "../src/samples/test-yard.json" with { type: "json" };

export const CARTESIA_URL = "https://api.cartesia.ai/tts/bytes";
const CARTESIA_VERSION = "2026-08-14";
const MODEL = "sonic-3.6";

export type MakeClips = {
  sentences: string[];
  apiKey: string;
  voiceId: string;
  have: Record<string, string>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  write: (name: string, bytes: Uint8Array) => Promise<void>;
};

export const sentencesToVoice = (): string[] => [
  ...new Set([...RULES.flatMap((row) => [row.plain.en, ...(row.unsure === null ? [] : [row.unsure.en])]), ...testYard.findings.map((f) => f.instruction)].map((s) => s.trim())),
];

const fileFor = (sentence: string): string => `voice/${createHash("sha256").update(sentence).digest("hex").slice(0, 24)}.mp3`;

export const makeClips = async (o: MakeClips): Promise<Record<string, string>> => {
  const clips = { ...o.have };
  for (const sentence of o.sentences) {
    if (clips[sentence] !== undefined) continue;
    const response = await o.fetch(CARTESIA_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${o.apiKey}`, "cartesia-version": CARTESIA_VERSION, "content-type": "application/json" },
      body: JSON.stringify({ model_id: MODEL, transcript: sentence, voice: { mode: "id", id: o.voiceId }, language: "en", output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 } }),
    });
    if (!response.ok) throw new Error(`Cartesia said ${response.status} for: ${sentence}`);
    const name = fileFor(sentence);
    await o.write(name, new Uint8Array(await response.arrayBuffer()));
    clips[sentence] = name;
  }
  return clips;
};

const main = async (): Promise<void> => {
  const apiKey = process.env.CARTESIA_API_KEY ?? "";
  const voiceId = process.env.CARTESIA_VOICE_ID ?? "";
  if (apiKey === "" || voiceId === "") throw new Error("CARTESIA_API_KEY and CARTESIA_VOICE_ID must both be set");
  const root = new URL("../", import.meta.url);
  const manifest = new URL("src/voice-clips.json", root);
  await mkdir(new URL("public/voice/", root), { recursive: true });
  const clips = await makeClips({
    sentences: sentencesToVoice(),
    apiKey,
    voiceId,
    have: JSON.parse(await readFile(manifest, "utf8")) as Record<string, string>,
    fetch: (url, init) => fetch(url, init),
    write: (name, bytes) => writeFile(new URL(`public/${name}`, root), bytes),
  });
  await writeFile(manifest, `${JSON.stringify(clips, null, 2)}\n`);
};

if (process.argv[1] === new URL(import.meta.url).pathname) await main();

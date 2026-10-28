import type { Language } from "@emberwalk/shared";
import { z } from "zod";
import type { Answer, Call, ContentKind, CostLine, FormRequest, MetaClient } from "./client.ts";
import { MetaRefused } from "./errors.ts";
import { PRICE_NANO_USD, TRANSCRIBE_MODEL } from "./prices.ts";

export const MAX_WAV_BYTES = 32 * 1024 * 1024;
export const MAX_WAV_SECONDS = 600;
export const WAV_RATES = [16000, 24000] as const;

export type WavFault = "not_wav" | "not_pcm" | "not_mono" | "not_16_bit" | "bad_rate" | "too_large" | "too_long" | "no_audio" | "truncated";

export type WavInfo = { sampleRate: number; channels: number; bitsPerSample: number; seconds: number };

export type Turn = { start: number; end: number; text: string };

export type TranscribeRequest = { wav: Uint8Array; walkId: string | null; content: ContentKind; language: Language };

const LANGUAGE_NAME: Record<Language, string> = { en: "English", es: "Spanish" };

const refuse = (fault: WavFault, detail: string): never => {
  throw new MetaRefused("invalid_audio", `${fault}: ${detail}`);
};

const tagAt = (v: DataView, at: number): string => String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3));

export function readWav(bytes: Uint8Array): WavInfo {
  if (bytes.length > MAX_WAV_BYTES) refuse("too_large", `${bytes.length} bytes is over ${MAX_WAV_BYTES}`);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || tagAt(v, 0) !== "RIFF" || tagAt(v, 8) !== "WAVE") refuse("not_wav", "not a RIFF WAVE file");
  let fmt: { format: number; channels: number; sampleRate: number; byteRate: number; bits: number } | null = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = tagAt(v, at);
    const size = v.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= bytes.length) {
      fmt = { format: v.getUint16(body, true), channels: v.getUint16(body + 2, true), sampleRate: v.getUint32(body + 4, true), byteRate: v.getUint32(body + 8, true), bits: v.getUint16(body + 14, true) };
    }
    if (id === "data") {
      if (fmt === null) return refuse("not_wav", "the data chunk comes before any fmt chunk");
      if (fmt.format !== 1) refuse("not_pcm", `format ${fmt.format} is not PCM`);
      if (fmt.channels !== 1) refuse("not_mono", `${fmt.channels} channels`);
      if (fmt.bits !== 16) refuse("not_16_bit", `${fmt.bits} bits per sample`);
      if (!(WAV_RATES as readonly number[]).includes(fmt.sampleRate)) refuse("bad_rate", `${fmt.sampleRate} Hz`);
      const seconds = size / fmt.byteRate;
      if (seconds > MAX_WAV_SECONDS) refuse("too_long", `${seconds} seconds is over ${MAX_WAV_SECONDS}`);
      if (size === 0) refuse("no_audio", "the data chunk is empty");
      if (body + size > bytes.length) refuse("truncated", `the data chunk says ${size} bytes and ${bytes.length - body} follow`);
      return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, seconds };
    }
    at = body + size + (size % 2);
  }
  return refuse("not_wav", "no data chunk");
}

const Answered = z.object({
  turns: z.array(
    z
      .object({ startMs: z.number().nonnegative(), endMs: z.number().nonnegative(), transcript: z.string() })
      .refine((t) => t.endMs >= t.startMs, { message: "a turn ends before it starts" }),
  ),
});

export function readTurns(raw: unknown): Turn[] {
  const parsed = Answered.safeParse(raw);
  if (!parsed.success) throw new MetaRefused("invalid_answer", `the Transcribe answer fails its shape: ${parsed.error.issues[0]?.message ?? ""}`);
  return parsed.data.turns
    .map((t) => ({ start: t.startMs / 1000, end: t.endMs / 1000, text: t.transcript.trim() }))
    .filter((t) => t.text !== "")
    .sort((a, b) => a.start - b.start);
}

export function transcribeCall(r: TranscribeRequest): Call<Turn[], FormRequest> {
  const billed = Math.floor(readWav(r.wav).seconds);
  const form = new FormData();
  const settings = { model: TRANSCRIBE_MODEL, mode: "ENDPOINTING", audioEncoding: "WAV", languageBias: [LANGUAGE_NAME[r.language]] };
  form.append("request", new Blob([JSON.stringify(settings)], { type: "application/json" }));
  form.append("audio", new Blob([r.wav as BlobPart], { type: "audio/wav" }), "sound.wav");
  const line: CostLine = { kind: "seconds", count: billed, unitPriceNano: PRICE_NANO_USD.transcribeSecond };
  return {
    model: TRANSCRIBE_MODEL,
    content: r.content,
    step: "transcribe",
    walkId: r.walkId,
    request: { method: "POST", path: "/asr/transcribe", form },
    estimateNano: billed * PRICE_NANO_USD.transcribeSecond,
    cost: () => [line],
    read: readTurns,
  };
}

export const transcribe = async (client: MetaClient, r: TranscribeRequest): Promise<Answer<Turn[]>> => client.call(transcribeCall(r));

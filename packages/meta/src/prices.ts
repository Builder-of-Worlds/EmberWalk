export const SAM_MODEL = "sam-3.1";
export const SPARK_MODELS = ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1"] as const;
export const SPARK_MODEL = SPARK_MODELS[0];
export const TRANSCRIBE_MODEL = "muse-voice-transcribe-1.0";
export const MUSE_IMAGE_MODEL = "muse-image-1.0";
export const SPARK_OPEN_MODEL = "meta-models/muse-spark-open-1026";

export type SamModel = typeof SAM_MODEL;
export type SparkModel = (typeof SPARK_MODELS)[number];
export type TranscribeModel = typeof TRANSCRIBE_MODEL;
export type Model = SamModel | SparkModel | TranscribeModel | typeof MUSE_IMAGE_MODEL | typeof SPARK_OPEN_MODEL;

const NANO = 1_000_000_000;

export const PRICE_NANO_USD = {
  samVideoFrame: 200_000,
  samImage: 2_500_000,
  sparkInputToken: 1_250,
  sparkCachedInputToken: 150,
  sparkOutputToken: 4_250,
  transcribeSecond: 50_000,
  museImage: 10_000_000,
  // Baseten Model APIs, meta-models/muse-spark-open: $1.25 input, $0.15 cached input, $4.25 output per 1M tokens (https://www.baseten.co/pricing/, read 2026-10-29).
  sparkOpenInputToken: 1_250,
  sparkOpenCachedInputToken: 150,
  sparkOpenOutputToken: 4_250,
} as const;

export const SAM_MIN_FRAMES = 50;

export const isStandardModel = (model: string): model is Model =>
  model === SAM_MODEL ||
  model === TRANSCRIBE_MODEL ||
  model === MUSE_IMAGE_MODEL ||
  model === SPARK_OPEN_MODEL ||
  (SPARK_MODELS as readonly string[]).includes(model);

export const toUsd = (nano: number): number => nano / NANO;
export const toNano = (usd: number): number => Math.round(usd * NANO);

export const samVideoFramesBilled = (frames: number): number => Math.max(frames, SAM_MIN_FRAMES);

export type TokenUse = { input: number; cachedInput: number; output: number };

export const sparkNano = (t: TokenUse): number =>
  t.input * PRICE_NANO_USD.sparkInputToken +
  t.cachedInput * PRICE_NANO_USD.sparkCachedInputToken +
  t.output * PRICE_NANO_USD.sparkOutputToken;

export const sparkOpenNano = (t: TokenUse): number =>
  t.input * PRICE_NANO_USD.sparkOpenInputToken +
  t.cachedInput * PRICE_NANO_USD.sparkOpenCachedInputToken +
  t.output * PRICE_NANO_USD.sparkOpenOutputToken;

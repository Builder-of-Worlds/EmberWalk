export const SAM_MODEL = "sam-3.1";
export const SPARK_MODELS = ["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.1"] as const;
export const SPARK_MODEL = SPARK_MODELS[0];

export type SamModel = typeof SAM_MODEL;
export type SparkModel = (typeof SPARK_MODELS)[number];
export type Model = SamModel | SparkModel;

const NANO = 1_000_000_000;

export const PRICE_NANO_USD = {
  samVideoFrame: 200_000,
  samImage: 2_500_000,
  sparkInputToken: 1_250,
  sparkCachedInputToken: 150,
  sparkOutputToken: 4_250,
} as const;

export const SAM_MIN_FRAMES = 50;

export const isStandardModel = (model: string): model is Model =>
  model === SAM_MODEL || (SPARK_MODELS as readonly string[]).includes(model);

export const toUsd = (nano: number): number => nano / NANO;
export const toNano = (usd: number): number => Math.round(usd * NANO);

export const samVideoFramesBilled = (frames: number): number => Math.max(frames, SAM_MIN_FRAMES);

export type TokenUse = { input: number; cachedInput: number; output: number };

export const sparkNano = (t: TokenUse): number =>
  t.input * PRICE_NANO_USD.sparkInputToken +
  t.cachedInput * PRICE_NANO_USD.sparkCachedInputToken +
  t.output * PRICE_NANO_USD.sparkOutputToken;

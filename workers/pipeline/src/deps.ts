import { cacheIndex, d1Ledger } from "@emberwalk/db";
import { type AnswerCache, basetenTransport, type Billing, fetchTransport, MetaClient, type Transport } from "@emberwalk/meta";
import { cacheMarkKey } from "@emberwalk/shared";
import type { Env } from "./env.ts";
import { mediaFetcher } from "./media-container.ts";
import { containerMedia, type Media } from "./media.ts";
import { r2Signer, type Signer } from "./storage.ts";
import { parseRenders, renderCheck } from "./synthetic.ts";

export type Deps = {
  db: D1Database;
  bucket: R2Bucket;
  media: Media;
  signer: Signer;
  meta: () => MetaClient;
  museImage: () => MetaClient;
  sleep: (ms: number) => Promise<void>;
  newId: () => string;
  voiceNotes: boolean;
  billing: Billing;
  isSyntheticRender: (key: string) => Promise<boolean>;
  baseten?: () => Baseten | null;
  secondCheckRealWalks?: boolean;
  rarePointLooks?: number;
  // Only a render with a known lens sets this; a phone walk uses the phone lens in the rules.
  longSideFovDegrees?: number;
};

export type Baseten = { client: MetaClient; transport: Transport };

const billingOf = (env: Env): Billing => (env.META_BILLING === "paid" ? "paid" : "free_credits");

type CachedAnswer = Awaited<ReturnType<AnswerCache["get"]>>;

export const r2Cache = (db: D1Database, bucket: R2Bucket, now: () => Date = () => new Date()): AnswerCache => {
  const index = cacheIndex(db);
  const mark = async (fingerprint: string, walkId: string): Promise<void> => {
    await bucket.put(cacheMarkKey(walkId, fingerprint), "");
  };
  return {
    async get(fingerprint) {
      const entry = await index.get(fingerprint);
      if (entry === null) return null;
      const stored = await bucket.get(entry.answer);
      return stored === null ? null : ((await stored.json()) as CachedAnswer);
    },
    async put(fingerprint, model, answer, walkId) {
      const key = `cache/${fingerprint}.json`;
      if (walkId !== null) await mark(fingerprint, walkId);
      await bucket.put(key, JSON.stringify(answer));
      await index.put({ fingerprint, model, createdAt: now().toISOString(), answer: key });
    },
    mark,
  };
};

export const MUSE_IMAGE_TIMEOUT_MS = 90_000;

export const metaFor = (env: Env, timeoutMs?: number): MetaClient => {
  if (!env.META_API_KEY) throw new Error("the Meta API key is not set up on this server");
  return new MetaClient({
    transport: fetchTransport({ baseUrl: env.META_BASE_URL, apiKey: env.META_API_KEY, ...(timeoutMs === undefined ? {} : { timeoutMs }) }),
    cache: r2Cache(env.DB, env.MEDIA),
    ledger: d1Ledger(env.DB),
    billing: billingOf(env),
  });
};

export const basetenFor = (env: Env): Baseten | null => {
  if (!env.BASETEN_API_KEY) return null;
  const transport = basetenTransport({ apiKey: env.BASETEN_API_KEY });
  const client = new MetaClient({
    transport,
    cache: r2Cache(env.DB, env.MEDIA),
    ledger: d1Ledger(env.DB),
    billing: env.META_BILLING === "paid" ? "paid" : "free_credits",
  });
  return { client, transport };
};

export const depsFrom = (env: Env): Deps => ({
  db: env.DB,
  bucket: env.MEDIA,
  media: containerMedia(mediaFetcher(env.MEDIA_CONTAINER)),
  signer: r2Signer(env),
  meta: () => metaFor(env),
  museImage: () => metaFor(env, MUSE_IMAGE_TIMEOUT_MS),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  newId: () => crypto.randomUUID(),
  voiceNotes: env.VOICE_NOTES === "on",
  billing: billingOf(env),
  isSyntheticRender: renderCheck(env.MEDIA, parseRenders(env.SYNTHETIC_RENDERS)),
  baseten: () => basetenFor(env),
  secondCheckRealWalks: env.SECOND_CHECK_REAL_WALKS === "on",
});

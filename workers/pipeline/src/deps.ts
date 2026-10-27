import { cacheIndex, d1Ledger } from "@emberwalk/db";
import { type AnswerCache, fetchTransport, MetaClient } from "@emberwalk/meta";
import type { Env } from "./env.ts";
import { containerMedia, type Media } from "./media.ts";
import { r2Signer, type Signer } from "./storage.ts";

export type Deps = {
  db: D1Database;
  bucket: R2Bucket;
  media: Media;
  signer: Signer;
  meta: () => MetaClient;
  sleep: (ms: number) => Promise<void>;
  newId: () => string;
};

type CachedAnswer = Awaited<ReturnType<AnswerCache["get"]>>;

export const r2Cache = (db: D1Database, bucket: R2Bucket, now: () => Date = () => new Date()): AnswerCache => {
  const index = cacheIndex(db);
  return {
    async get(fingerprint) {
      const entry = await index.get(fingerprint);
      if (entry === null) return null;
      const stored = await bucket.get(entry.answer);
      return stored === null ? null : ((await stored.json()) as CachedAnswer);
    },
    async put(fingerprint, model, answer) {
      const key = `cache/${fingerprint}.json`;
      await bucket.put(key, JSON.stringify(answer));
      await index.put({ fingerprint, model, createdAt: now().toISOString(), answer: key });
    },
  };
};

export const metaFor = (env: Env): MetaClient => {
  if (!env.META_API_KEY) throw new Error("the Meta API key is not set up on this server");
  return new MetaClient({
    transport: fetchTransport({ baseUrl: env.META_BASE_URL, apiKey: env.META_API_KEY }),
    cache: r2Cache(env.DB, env.MEDIA),
    ledger: d1Ledger(env.DB),
    billing: env.META_BILLING === "paid" ? "paid" : "free_credits",
  });
};

export const depsFrom = (env: Env): Deps => ({
  db: env.DB,
  bucket: env.MEDIA,
  media: containerMedia(env.MEDIA_CONTAINER),
  signer: r2Signer(env),
  meta: () => metaFor(env),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  newId: () => crypto.randomUUID(),
});

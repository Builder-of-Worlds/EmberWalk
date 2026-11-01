import { cacheIndex, d1Ledger } from "@emberwalk/db";
import { type AnswerCache, fetchTransport, MetaClient } from "@emberwalk/meta";
import { cacheMarkKey } from "@emberwalk/shared";
import type { Env } from "./env.ts";

export type Deps = {
  env: Env;
  db: D1Database;
  media: R2Bucket;
  enabled: boolean;
  meta: () => MetaClient;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  now: () => Date;
  newId: () => string;
  newToken: () => string;
};

type CachedAnswer = Awaited<ReturnType<AnswerCache["get"]>>;

export const r2Cache = (db: D1Database, bucket: R2Bucket): AnswerCache => {
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
      await index.put({ fingerprint, model, createdAt: new Date().toISOString(), answer: key });
    },
    mark,
  };
};

export class ModelOff extends Error {
  constructor() {
    super("the Meta API key is not set up on this server");
    this.name = "ModelOff";
  }
}

export const metaFor = (env: Env): MetaClient => {
  if (!env.META_API_KEY) throw new ModelOff();
  return new MetaClient({
    transport: fetchTransport({ baseUrl: env.META_BASE_URL, apiKey: env.META_API_KEY }),
    cache: r2Cache(env.DB, env.MEDIA),
    ledger: d1Ledger(env.DB),
    billing: env.META_BILLING === "paid" ? "paid" : "free_credits",
  });
};

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

export const randomToken = (): string => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => ALPHABET[b % ALPHABET.length]).join("");

export const depsFrom = (env: Env): Deps => ({
  env,
  db: env.DB,
  media: env.MEDIA,
  enabled: env.GET_IT_FIXED === "on",
  meta: () => metaFor(env),
  fetch: (input, init) => fetch(input, init),
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
  newToken: randomToken,
});

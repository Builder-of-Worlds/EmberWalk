// Asks SAM 3.1 other words for some concepts on one stored clip of one finished live walk; the phrase trial scores the answers with no further calls.
// node --experimental-transform-types --no-warnings tools/phrase-probe.ts --state <copy of a live walk's --state folder> --video <the walk's mp4> [--clip loop|pan] --sam-phrase concept=words [...] --out <file> --limit-usd <n> [--fake]
import { randomUUID } from "node:crypto";
import { createReadStream, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { parseArgs } from "node:util";
import type { Transport } from "@emberwalk/meta";

const STUB = `data:text/javascript,export class WorkflowEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } export class Container {} export const getContainer = () => { throw new Error("no container in a local run"); };`;
registerHooks({
  resolve: (specifier, context, next) =>
    specifier === "cloudflare:workers" || specifier === "@cloudflare/containers" ? { url: STUB, shortCircuit: true } : next(specifier, context),
});

const PROBE_LIMIT_USD = 5;

const { values: args } = parseArgs({
  options: {
    state: { type: "string" },
    video: { type: "string" },
    clip: { type: "string", default: "loop" },
    out: { type: "string" },
    "limit-usd": { type: "string" },
    "sam-phrase": { type: "string", multiple: true },
    fake: { type: "boolean", default: false },
  },
});
if (args.state === undefined || args.video === undefined || args.out === undefined || args["limit-usd"] === undefined) {
  throw new Error("--state, --video, --out and --limit-usd are required");
}
const state = resolve(args.state);
const video = resolve(args.video);
const out = resolve(args.out);
const limitUsd = Number(args["limit-usd"]);
if (!(limitUsd > 0 && limitUsd <= PROBE_LIMIT_USD)) throw new Error(`--limit-usd must be above 0 and at most ${PROBE_LIMIT_USD}`);
const kind = args.clip;
if (kind !== "loop" && kind !== "pan") throw new Error("--clip is loop or pan");
const pairs = args["sam-phrase"] ?? [];
if (pairs.length === 0) throw new Error("name at least one --sam-phrase concept=words");

const { MetaClient, choosePhrases, fetchTransport } = await import("@emberwalk/meta");
// Refuses the whole list before any call when one pair is not in the phrase table.
choosePhrases(pairs);
const asked = pairs.map((p) => ({ concept: p.slice(0, p.indexOf("=")) as never, phrase: p.slice(p.indexOf("=") + 1) }));

const key = process.env["META_API_KEY"]?.trim() ?? "";
if (!args.fake && (process.env["EMBERWALK_LIVE"] !== "1" || key === "")) throw new Error("a live probe needs EMBERWALK_LIVE=1 and META_API_KEY in the environment");

const { getPlatformProxy } = await import("wrangler");
const flare = await getPlatformProxy<{ DB: D1Database; MEDIA: R2Bucket }>({ configPath: join(state, "wrangler.json"), persist: { path: join(state, "persist") } });
const db = flare.env.DB;
const bucket = flare.env.MEDIA;
const { d1Ledger } = await import("@emberwalk/db");
const { limitsWith } = await import("@emberwalk/shared");
const { r2Cache } = await import("../../../../workers/pipeline/src/deps.ts");
const { probePhrases } = await import("../../../../workers/pipeline/src/phrase-probe.ts");
const { PhraseAnswers } = await import("../replay/phrase-trial.ts");
const { pass, refuse } = await import("../../../../workers/pipeline/src/outcome.ts");
const { originalKey } = await import("../../../../workers/pipeline/src/storage.ts");
const { clipOp, probeOp } = await import("../../../../containers/media/src/ops.ts");
const { MediaError } = await import("../../../../containers/media/src/errors.ts");

const { results: walks } = await db.prepare("SELECT id FROM walks").all<{ id: string }>();
if (walks.length !== 1) throw new Error(`the state folder holds ${walks.length} walks, not one`);
const walkId = walks[0]!.id;

// The local cutter reads the original from this machine's file and writes the clip into the state folder's storage.
const server = createServer((req, res) => {
  const k = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname.slice(1));
  void (async () => {
    if (req.method === "GET" && k === originalKey(walkId)) {
      res.writeHead(200, { "content-length": statSync(video).size });
      createReadStream(video).pipe(res);
      return;
    }
    if (req.method === "GET") {
      const stored = await bucket.get(k);
      if (stored === null) return void res.writeHead(404).end();
      const bytes = Buffer.from(await stored.arrayBuffer());
      return void res.writeHead(200, { "content-length": bytes.length }).end(bytes);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of Readable.from(req)) chunks.push(chunk as Buffer);
    await bucket.put(k, Buffer.concat(chunks));
    res.writeHead(200).end();
  })().catch(() => res.destroy());
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const linkOf = (k: string): string => `http://127.0.0.1:${(server.address() as { port: number }).port}/${encodeURIComponent(k)}`;
const media = <Q, A>(op: (q: Q) => Promise<A>) => async (q: Q) => {
  try {
    return pass(await op(q));
  } catch (error) {
    if (error instanceof MediaError && error.status < 500) return refuse(`media_${error.code}`.slice(0, 60), error.message.slice(0, 300));
    throw error;
  }
};
const probing = media(probeOp);

const ledger = d1Ledger(db);
const spentBefore = await ledger.spentUsd(new Date().toISOString().slice(0, 10));
const last = (await db.prepare("SELECT COALESCE(MAX(rowid), 0) AS n FROM cost_records").first<{ n: number }>())?.n ?? 0;

const fakeTransport: Transport = async (req) => ({
  status: 200,
  retryAfter: null,
  text: JSON.stringify(
    req.path.startsWith("/files")
      ? { id: "file-fake", status: "processed" }
      : { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "" }] }], usage: { video_frames_processed: 1 } },
  ),
});
const transport = args.fake ? fakeTransport : fetchTransport({ baseUrl: "https://api.meta.ai/v1", apiKey: key });
// The cap counts only this probe: the stored walk's own spend today is added to it.
const client = new MetaClient({ transport, cache: r2Cache(db, bucket), ledger, billing: "free_credits", limits: limitsWith({ dailySpendUsd: spentBefore + limitUsd }) });
const deps = {
  db,
  bucket,
  meta: () => client,
  media: { probe: (input: string) => probing({ input }), clip: media(clipOp) },
  signer: { get: async (k: string) => linkOf(k), put: async (k: string) => linkOf(k) },
  sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)), newId: () => randomUUID() } as never;

const log = (line: string): void => console.log(`${new Date().toISOString()} ${line}`);
log(`walk ${walkId}: ${asked.length} phrases on the ${kind} clip${args.fake ? " on fake answers" : " on live Meta"}, limit $${limitUsd}`);
const answers = await probePhrases(deps, walkId, asked, kind);
for (const a of answers) log(`${a.concept}="${a.phrase}": ${a.run.outcome}, ${a.tracks.length} tracks`);
writeFileSync(out, `${JSON.stringify(PhraseAnswers.parse({ walkId, answers }))}\n`);
const { results: costs } = await db.prepare("SELECT * FROM cost_records WHERE rowid > ? ORDER BY rowid").bind(last).all<Record<string, unknown>>();
writeFileSync(`${out.replace(/\.json$/, "")}-ledger.json`, `${JSON.stringify(costs, null, 1)}\n`);
log(`ledger: ${costs.length} calls, $${costs.reduce((sum, row) => sum + Number(row["total_nano"]) / 1e9, 0).toFixed(4)}; answers in ${out}`);
server.close();
await flare.dispose();

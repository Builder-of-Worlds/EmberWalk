// Runs one rendered walk through the real WalkPipeline on this machine: local D1 and R2, local ffmpeg, live Meta.
// node --experimental-transform-types --no-warnings tools/live-walk.ts --video <mp4> --scene hero-before [--fixtures <dir>] [--sample-id <id>] [--second-check] --state <dir> --out <dir> --limit-usd <n> [--fake]
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { registerHooks } from "node:module";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Transport } from "@emberwalk/meta";

const STUB = `data:text/javascript,export class WorkflowEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } export class Container {} export const getContainer = () => { throw new Error("no container in a local run"); };`;
registerHooks({
  resolve: (specifier, context, next) =>
    specifier === "cloudflare:workers" || specifier === "@cloudflare/containers" ? { url: STUB, shortCircuit: true } : next(specifier, context),
});

const REPO = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const { values: args } = parseArgs({
  options: {
    video: { type: "string" },
    scene: { type: "string" },
    fixtures: { type: "string" },
    "sample-id": { type: "string" },
    "rare-looks": { type: "string" },
    "second-check": { type: "boolean", default: false },
    state: { type: "string" },
    out: { type: "string" },
    "limit-usd": { type: "string" },
    "resume-walk": { type: "string" },
    fake: { type: "boolean", default: false },
    "sam-phrase": { type: "string", multiple: true },
  },
});
const need = (name: "video" | "scene" | "state" | "out" | "limit-usd"): string => {
  const value = args[name];
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
};
const video = need("video");
const scene = need("scene");
const state = resolve(need("state"));
const out = resolve(need("out"));
const limitUsd = Number(need("limit-usd"));
if (!(limitUsd > 0 && limitUsd <= 20)) throw new Error("--limit-usd must be above 0 and at most the $20 daily cap");

// A scene still on the render machine is read from a copy of its folder and has no render file: its parts file carries the label.
const folder = args.fixtures === undefined ? join(REPO, "fixtures/synthetic", scene) : resolve(args.fixtures);
const fixture = (name: string) => JSON.parse(readFileSync(join(folder, name), "utf8"));
const route = fixture("parts.json");
const recorded = existsSync(join(folder, "render.json")) ? fixture("render.json") : null;
const named = recorded ?? route;
if (named.synthetic !== true || named.label !== "Synthetic sample house") throw new Error("only a labelled synthetic render may run");
if (recorded !== null && statSync(video).size !== recorded.size_bytes) throw new Error("the video's size is not the render's");
const hash = createHash("sha256");
for await (const chunk of createReadStream(video)) hash.update(chunk as Buffer);
const videoSha = hash.digest("hex");
if (recorded !== null && videoSha !== recorded.sha256) throw new Error("the video's hash is not the render's");

const log = (line: string): void => console.log(`${new Date().toISOString()} ${line}`);

mkdirSync(state, { recursive: true });
const configPath = join(state, "wrangler.json");
writeFileSync(
  configPath,
  JSON.stringify({
    name: "live-walk",
    compatibility_date: "2026-01-01",
    d1_databases: [{ binding: "DB", database_name: "live-walk", database_id: "live-walk" }],
    r2_buckets: [{ binding: "MEDIA", bucket_name: "live-walk" }],
  }),
);
const { getPlatformProxy } = await import("wrangler");
const flare = await getPlatformProxy<{ DB: D1Database; MEDIA: R2Bucket }>({ configPath, persist: { path: join(state, "persist") } });
const db = flare.env.DB;
const bucket = flare.env.MEDIA;

const migrationsDir = join(REPO, "migrations");
const statementsOf = (sql: string): string[] => {
  const statements: string[] = [];
  let held = "";
  for (const line of sql.split("\n")) {
    if (line.trim() === "" || line.trim().startsWith("--")) continue;
    held += `${line}\n`;
    const insideTrigger = /CREATE\s+TRIGGER/i.test(held) && !/END;\s*$/i.test(held);
    if (line.trimEnd().endsWith(";") && !insideTrigger) {
      statements.push(held);
      held = "";
    }
  }
  return statements;
};
const applied = await db.prepare("SELECT name FROM sqlite_master WHERE name = 'walks'").first();
if (applied === null) {
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of statementsOf(readFileSync(join(migrationsDir, file), "utf8"))) await db.prepare(statement).run();
  }
}

const { createWalk, findingsForWalk, addTag, detectionsForClip, clipsForWalk } = await import("@emberwalk/db");
const { WalkPipeline } = await import("../../../../workers/pipeline/src/workflow.ts");
const { r2Cache } = await import("../../../../workers/pipeline/src/deps.ts");
const { pass, refuse } = await import("../../../../workers/pipeline/src/outcome.ts");
const { MetaClient, basetenTransport, fetchTransport, choosePhrases } = await import("@emberwalk/meta");
const { secondCheckTally, secondCheckTransport } = await import("./second-check-route.ts");
// --sam-phrase concept=words asks SAM those words for that concept on this run only; they must be listed in its phrase table row.
choosePhrases(args["sam-phrase"] ?? []);
const { d1Ledger } = await import("@emberwalk/db");
const { limitsWith, previewKey } = await import("@emberwalk/shared");
const { resultsFor } = await import("../../../../workers/api/src/walk-read.ts");
const { audioOp, clipOp, probeOp, stillsOp } = await import("../../../../containers/media/src/ops.ts");
const { MediaError } = await import("../../../../containers/media/src/errors.ts");
const { footageFits, routeTags, walkExitCode } = await import("./route-tags.ts");
const { scoredFindingsOf } = await import("./scored-findings.ts");
const { sampleOf } = await import("./sample-fixture.ts");

const { completeWalk, tagsForWalk } = await import("@emberwalk/db");
const { blurWalk } = await import("../../../../workers/pipeline/src/workflow.ts");
const { scoreWalk } = await import("../../../../workers/pipeline/src/score.ts");
const { storeVoiceNotes } = await import("../../../../workers/pipeline/src/voice-notes.ts");
const { explainWalk } = await import("../../../../workers/pipeline/src/explain-step.ts");
const { secondCheckWalk } = await import("../../../../workers/pipeline/src/second-check-step.ts");
const { previewWalk } = await import("../../../../workers/pipeline/src/preview-step.ts");

const WALK_ID = args["resume-walk"] ?? randomUUID();
const ORIGINAL = `originals/${WALK_ID}/walk.mp4`;

const server = createServer((req, res) => {
  const key = decodeURIComponent(new URL(req.url ?? "/", "http://local").pathname.slice(1));
  void (async () => {
    if (req.method === "GET" && key === ORIGINAL) {
      res.writeHead(200, { "content-length": statSync(video).size });
      createReadStream(video).pipe(res);
      return;
    }
    if (req.method === "GET") {
      const stored = await bucket.get(key);
      if (stored === null) {
        res.writeHead(404).end();
        return;
      }
      const bytes = Buffer.from(await stored.arrayBuffer());
      res.writeHead(200, { "content-length": bytes.length }).end(bytes);
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of Readable.from(req)) chunks.push(chunk as Buffer);
    await bucket.put(key, Buffer.concat(chunks));
    res.writeHead(200).end();
  })().catch((error: unknown) => {
    log(`local storage failed on ${key}: ${String(error)}`);
    res.destroy();
  });
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = (server.address() as { port: number }).port;
const linkOf = (key: string): string => `http://127.0.0.1:${port}/${encodeURIComponent(key)}`;
const media = <Q, A>(op: (q: Q) => Promise<A>) => async (q: Q) => {
  try {
    return pass(await op(q));
  } catch (error) {
    if (error instanceof MediaError && error.status < 500) return refuse(`media_${error.code}`.slice(0, 60), error.message.slice(0, 300));
    throw error;
  }
};
const probing = media(probeOp);
const fileKeys = { probe: (input: string) => probing({ input }), clip: media(clipOp), stills: media(stillsOp), audio: media(audioOp) };

const key = process.env["META_API_KEY"]?.trim() ?? "";
if (!args.fake && (process.env["EMBERWALK_LIVE"] !== "1" || key === "")) throw new Error("a live run needs EMBERWALK_LIVE=1 and META_API_KEY in the environment");

// Every fake answer is one box low in the picture on every tenth frame: not a measurement, only enough to carry findings to the end of the run.
const FAKE_MASK = "!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(";
const FAKE_BOX = "x1=500;y1=420;x2=800;y2=640;w=1280;h=720;c=0.9";
const fakeText = Array.from({ length: 40 }, (_, i) => `<${i * 10}f>0<|box;${FAKE_BOX}|><|mask;x=0;y=0;data=27,60,~${FAKE_MASK}|>`).join("\n");
const SAM_FAKE = { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: fakeText }] }], usage: { video_frames_processed: 1 } };
const fakeTransport: Transport = async (req) => ({
  status: 200,
  retryAfter: null,
  text: JSON.stringify(req.path.startsWith("/files") ? { id: "file-fake", status: "processed" } : SAM_FAKE),
});
const transport = args.fake ? fakeTransport : fetchTransport({ baseUrl: "https://api.meta.ai/v1", apiKey: key });
const limits = limitsWith({ dailySpendUsd: limitUsd });
const client = (): InstanceType<typeof MetaClient> =>
  new MetaClient({ transport, cache: r2Cache(db, bucket), ledger: d1Ledger(db), billing: "free_credits", limits });
const checkTransport = secondCheckTransport({
  wanted: args["second-check"] === true,
  fake: args.fake === true,
  apiKey: process.env["BASETEN_API_KEY"]?.trim() ?? "",
  connect: (apiKey) => basetenTransport({ apiKey }),
});
const baseten =
  checkTransport === null
    ? null
    : { transport: checkTransport, client: new MetaClient({ transport: checkTransport, cache: r2Cache(db, bucket), ledger: d1Ledger(db), billing: "free_credits", limits }) };

const deps = {
  db,
  bucket,
  media: fileKeys,
  // Meta cannot reach a local link, so a proof still goes to it inside the request.
  signer: {
    get: async (k: string) => {
      if (!k.startsWith("stills/")) return linkOf(k);
      const stored = await bucket.get(k);
      if (stored === null) throw new Error(`the still ${k} is missing`);
      return `data:image/jpeg;base64,${Buffer.from(await stored.arrayBuffer()).toString("base64")}`;
    },
    put: async (k: string) => linkOf(k),
  },
  meta: client,
  museImage: client,
  sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)),
  newId: () => randomUUID(),
  voiceNotes: true,
  billing: "free_credits" as const,
  isSyntheticRender: async () => true,
  baseten: () => baseten,
  secondCheckRealWalks: false,
  longSideFovDegrees: fixture("motion.json").camera.hfov_deg as number,
  ...(args["rare-looks"] === undefined ? {} : { rarePointLooks: Number(args["rare-looks"]) }),
};

class LocalPipeline extends WalkPipeline {
  protected override deps() {
    return deps as never;
  }
}

const step = {
  do: async (name: string, ...rest: unknown[]) => {
    const work = rest.pop() as () => Promise<unknown>;
    const config = rest[0] as { retries?: { limit: number } } | undefined;
    const tries = (config?.retries?.limit ?? 0) + 1;
    const started = Date.now();
    for (let attempt = 1; ; attempt += 1) {
      try {
        const value = await work();
        if (!name.startsWith("count")) log(`step ${name} done in ${Math.round((Date.now() - started) / 1000)} s`);
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
      } catch (error) {
        log(`step ${name} try ${attempt} of ${tries} threw: ${error instanceof Error ? error.message : String(error)}`);
        if (attempt >= tries) throw error;
      }
    }
  },
};

let tags;
let outcome: unknown;
if (args["resume-walk"] === undefined) {
  const footage = await probeOp({ input: linkOf(ORIGINAL) });
  if (!footageFits(route, footage.durationSeconds)) throw new Error(`the video runs ${footage.durationSeconds} s and the route ${route.duration_s} s`);
  await createWalk(db, {
    id: WALK_ID,
    visitorId: createHash("sha256").update(WALK_ID).digest("hex"),
    language: "en",
    jurisdiction: "ca",
    device: { camera: "synthetic render", width: footage.video?.width ?? 0, height: footage.video?.height ?? 0 },
    synthetic: true,
  });
  tags = routeTags(WALK_ID, route, fixture("motion.json"), fixture("truth.json").footprint, randomUUID);
  for (const tag of tags) await addTag(db, tag);
  await db.prepare("UPDATE walks SET state = 'queued' WHERE id = ?").bind(WALK_ID).run();
  log(`walk ${WALK_ID} queued with ${tags.length} tags${args.fake ? " on fake answers" : " on live Meta"}, limit $${limitUsd}`);
  const pipeline = new LocalPipeline({} as never, {} as never);
  outcome = await pipeline.run({ payload: { walkId: WALK_ID } } as never, step as never).catch((error: unknown) => ({ status: "threw", message: String(error) }));
} else {
  // SAM, privacy and coverage are already stored for this walk: only the steps after them run, in the Workflow's order.
  tags = await tagsForWalk(db, WALK_ID);
  await db.prepare("UPDATE walks SET state = 'processing', step = 'score', failure_code = NULL, failure_message = NULL WHERE id = ?").bind(WALK_ID).run();
  log(`walk ${WALK_ID} resumes from its stored answers${args.fake ? " on fake answers" : " on live Meta"}, limit $${limitUsd}`);
  const d = deps as never;
  const missing: string[] = [];
  outcome = await (async () => {
    const scored = (await step.do("score", () => scoreWalk(d, WALK_ID))) as { ok: boolean; value?: { findings: unknown[] } };
    log(`score kept ${scored.value?.findings.length ?? "no"} findings`);
    await step.do("voice notes", () => storeVoiceNotes(d, WALK_ID));
    await step.do("blur", async () => blurWalk(d, WALK_ID, await clipsForWalk(db, WALK_ID)));
    await db.prepare("UPDATE walks SET step = 'explain' WHERE id = ?").bind(WALK_ID).run();
    log(`explain answered ${JSON.stringify(await step.do("explain", () => explainWalk(d, WALK_ID)))}`);
    for (const [name, extra] of [["second check", secondCheckWalk], ["preview", previewWalk]] as const) {
      await step.do(name, () => extra(d, WALK_ID)).catch((error: unknown) => {
        log(`walk goes on without ${name}: ${String(error)}`);
        missing.push(name);
      });
    }
    await step.do("complete walk", () => completeWalk(db, WALK_ID));
    return { status: "done", missing };
  })().catch((error: unknown) => ({ status: "threw", message: String(error) }));
}
log(`pipeline answered ${JSON.stringify(outcome)}`);

mkdirSync(join(out, "stills"), { recursive: true });
const walk = await db.prepare("SELECT state, step, failure_code, failure_message FROM walks WHERE id = ?").bind(WALK_ID).first();
const { results: costs } = await db.prepare("SELECT * FROM cost_records WHERE walk_id = ? OR walk_id IS NULL ORDER BY rowid").bind(WALK_ID).all<Record<string, unknown>>();
const write = (name: string, value: unknown): void => writeFileSync(join(out, name), `${JSON.stringify(value, null, 1)}\n`);
write("ledger.json", costs);
const clips = await clipsForWalk(db, WALK_ID);
// Truth masks are in the camera file's pixels: a box compares raw only at scale 1, otherwise by fractions.
const maskWidth = fixture("motion.json").camera.width_px as number;
const truthScale = clips.map((clip) => ({ kind: clip.kind, width: clip.width, height: clip.height, scale: clip.width / maskWidth }));
write("walk.json", { walkId: WALK_ID, scene, sha256: videoSha, truthScale, outcome, walk, tags: tags.map(({ samples: _samples, ...t }) => t) });

const tracks = await Promise.all(
  clips.map(async (clip) => {
    const d = await detectionsForClip(db, clip.id);
    return {
      clip: { kind: clip.kind, frames: clip.frameCount, fps: clip.fps },
      runs: d.runs,
      tracks: d.tracks.map((t) => ({
        id: t.id,
        concept: t.concept,
        frames: t.frames.length,
        first: Math.min(...t.frames.map((f) => f.frame)),
        last: Math.max(...t.frames.map((f) => f.frame)),
        best: Math.max(...t.frames.map((f) => f.confidence)),
        boxes: t.frames.map((f) => [f.frame, Number(f.confidence.toFixed(2)), ...f.box.map((v) => Number(v.toFixed(3)))]),
      })),
    };
  }),
);
write("detections.json", tracks);

const record = await (await import("@emberwalk/db")).getWalk(db, WALK_ID);
if (record?.state.name === "done") {
  const findings = await findingsForWalk(db, WALK_ID);
  const results = await resultsFor(db, bucket, record);
  write("results.json", results);
  log(`second check: ${JSON.stringify(secondCheckTally(results.findings))}`);
  const tracksByClip = new Map(await Promise.all(clips.map(async (clip) => [clip.id, (await detectionsForClip(db, clip.id)).tracks] as const)));
  write("scored-findings.json", scoredFindingsOf(tags, clips, (id) => tracksByClip.get(id) ?? [], findings, results.findings));
  const stills: Record<string, string> = {};
  const previews = new Set<string>();
  for (const [i, f] of findings.entries()) {
    const still = await bucket.get(f.proofFrame.still);
    if (still !== null) {
      stills[f.id] = `${i + 1}-${f.id}.jpg`;
      writeFileSync(join(out, "stills", stills[f.id]!), Buffer.from(await still.arrayBuffer()));
    }
    const preview = await bucket.get(previewKey(WALK_ID, f.id));
    if (preview !== null) {
      previews.add(f.id);
      writeFileSync(join(out, "stills", `${i + 1}-${f.id}-preview.jpg`), Buffer.from(await preview.arrayBuffer()));
    }
  }
  if (args["sample-id"] !== undefined) write("sample.json", sampleOf(results as never, args["sample-id"], stills, previews));
}
const spent = costs.reduce((sum, row) => sum + Number(row["total_nano"]) / 1e9, 0);
log(`ledger: ${costs.length} calls, $${spent.toFixed(4)}`);
server.close();
await flare.dispose();
process.exit(walkExitCode(outcome as { status: string }));

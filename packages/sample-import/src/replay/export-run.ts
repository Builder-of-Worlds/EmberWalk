// Writes one live walk's stored Meta answers from its local database (the --state folder of tools/live-walk.ts) into the scene's fixture folder.
// node --experimental-transform-types --no-warnings packages/sample-import/src/replay/export-run.ts --state <dir> --walk <id> --scene <name> --video-sha256 <hex> --fov <degrees>
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { clipsForWalk, detectionsForClip, getWalk, tagsForWalk } from "@emberwalk/db";
import { STORED_RUN_FILE, StoredRun } from "./stored-run.ts";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const { values: args } = parseArgs({ options: { state: { type: "string" }, walk: { type: "string" }, scene: { type: "string" }, "video-sha256": { type: "string" }, fov: { type: "string" } } });
const need = (name: keyof typeof args): string => {
  const value = args[name];
  if (value === undefined) throw new Error(`--${name} is required`);
  return value;
};
const state = resolve(need("state"));
const walkId = need("walk");

const { getPlatformProxy } = await import("wrangler");
const flare = await getPlatformProxy<{ DB: D1Database }>({ configPath: join(state, "wrangler.json"), persist: { path: join(state, "persist") } });
const db = flare.env.DB;
const walk = await getWalk(db, walkId);
if (walk === null) throw new Error(`walk ${walkId} is not in ${state}`);
const clips = await clipsForWalk(db, walkId);
const detections = await Promise.all(clips.map(async (clip) => ({ clipId: clip.id, ...(await detectionsForClip(db, clip.id)) })));
const { results: costs } = await db
  .prepare("SELECT model, step, count(*) AS calls, sum(total_nano) AS nano, min(at) AS first, max(at) AS last FROM cost_records WHERE walk_id = ? GROUP BY model, step ORDER BY model, step")
  .bind(walkId)
  .all<{ model: string; step: string; calls: number; nano: number; first: string; last: string }>();
const run = StoredRun.parse({
  walkId,
  scene: need("scene"),
  videoSha256: need("video-sha256"),
  jurisdiction: walk.jurisdiction,
  language: walk.language,
  longSideFovDegrees: Number(need("fov")),
  metaCalls: costs.map((c) => ({ model: c.model, step: c.step, calls: c.calls, usd: Number((c.nano / 1e9).toFixed(4)), first: c.first, last: c.last })),
  clips,
  tags: await tagsForWalk(db, walkId),
  detections,
});
const file = join(REPO, "fixtures/synthetic", run.scene, STORED_RUN_FILE);
writeFileSync(file, `${JSON.stringify(run)}\n`);
console.log(`${file}: ${run.clips.length} clips, ${detections.reduce((n, d) => n + d.tracks.length, 0)} tracks, ${run.metaCalls.reduce((n, c) => n + c.calls, 0)} Meta calls`);
await flare.dispose();

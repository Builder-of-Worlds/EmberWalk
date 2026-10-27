import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import { statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sampleResults } from "./sample-results.ts";

const video = process.argv[2];
assert.ok(video, "usage: node scripts/write-sample.ts <path to test-yard/walk.mp4>");
assert.equal(statSync(video).size, 22_576_900, "the video must be the test-yard render named in fixtures/synthetic/test-yard/render.json");

const results = sampleResults();
const out = (name: string) => fileURLToPath(new URL(`../src/samples/${name}`, import.meta.url));
writeFileSync(out("test-yard.json"), `${JSON.stringify(results, null, 2)}\n`);
for (const { proof } of results.findings)
  execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(proof.seconds), "-i", video, "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "4", out(proof.still)]);

import { env, exports } from "cloudflare:workers";
import { ErrorBody, stillPath, VISITOR_HEADER, WalkResultsResponse, WalkStatusResponse } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { handleWalkRead, READ_PATH } from "../src/walk-read.ts";
import { emptyBucket } from "./route.ts";
import { clearWalks, type DoneWalk, OWNER, seedDoneWalk, seedWalk } from "./seed.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7c01";
const OTHER = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7c02";
const UNKNOWN = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7cff";
const STRANGER = "b".repeat(64);

const request = (path: string, visitor: string | null = OWNER, method = "GET"): Request =>
  new Request(`https://api.test${path}`, { method, headers: visitor === null ? {} : { [VISITOR_HEADER]: visitor } });

const get = (path: string, visitor: string | null = OWNER, method = "GET") => exports.default.fetch(request(path, visitor, method));

const refused = async (response: Response, status: number, code: string): Promise<void> => {
  const body = ErrorBody.parse(await response.json());
  expect([response.status, body.error.code]).toEqual([status, code]);
};

const setFinding = (id: string, column: "proof_still" | "rule_ids", value: string) =>
  env.DB.prepare(`UPDATE findings SET ${column} = ? WHERE id = ?`).bind(value, id).run();

const spyBucket = (): R2Bucket & { asked: string[] } => {
  const asked: string[] = [];
  return Object.assign(Object.create(env.MEDIA) as R2Bucket, { asked, get: async (key: string) => (asked.push(key), env.MEDIA.get(key)) });
};

let walk: DoneWalk;

beforeEach(async () => {
  await clearWalks();
  await emptyBucket();
  walk = await seedDoneWalk(WALK, 1);
  await seedDoneWalk(OTHER, 2);
});

describe("GET /api/walks/{walkId}", () => {
  it("answers the state of a walk in every state, with the failure of a failed walk", async () => {
    const states: [string, string | null][] = [
      ["recording", null],
      ["uploading", null],
      ["queued", null],
      ["processing", "segment"],
      ["failed", "segment"],
    ];
    for (const [i, [state, step]] of states.entries()) {
      const id = `6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7d0${i}`;
      await seedWalk(id, state, step);
      const body = WalkStatusResponse.parse(await (await get(`/api/walks/${id}`)).json());
      expect(body).toEqual({ walkId: id, state: step === null ? { name: state } : { name: state, step }, failure: null });
    }
    const failed = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7d04";
    await env.DB.prepare("UPDATE walks SET failure_code = 'segment_failed', failure_message = 'Something went wrong.' WHERE id = ?").bind(failed).run();
    expect(await (await get(`/api/walks/${failed}`)).json()).toMatchObject({ failure: { code: "segment_failed", message: "Something went wrong." } });
    expect(await (await get(`/api/walks/${WALK}`)).json()).toEqual({ walkId: WALK, state: { name: "done" }, failure: null });
  });
});

describe("GET /api/walks/{walkId}/results", () => {
  it("gives the phone each open finding in rank order with sources, marker, seconds and what was not checked", async () => {
    const response = await get(`/api/walks/${WALK}/results`);
    expect(response.status).toBe(200);
    const body = WalkResultsResponse.parse(await response.json());
    expect(body).toMatchObject({ walkId: WALK, synthetic: true, coverage: "not_checked", gaps: [], notChecked: ["chimney", "propane_tank"] });
    expect(body.walkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.findings.map((f) => f.id)).toEqual([walk.fence.id, walk.brush.id]);
    const [fence, brush] = body.findings;
    expect(fence).toMatchObject({
      concept: "wooden_fence",
      band: "zone_0",
      label: "recommended",
      confidence: 0.74,
      proof: { still: stillPath(WALK, walk.fence.id), frame: 4, seconds: 41, marker: [0.5, 0.3, 0.9, 0.7] },
    });
    expect(brush).toMatchObject({
      instruction: "Remove dry brush within 30 feet of the house.",
      distanceFeet: { low: 6, high: 9 },
      confidence: 0.82,
      proof: { still: stillPath(WALK, walk.brush.id), frame: 10, seconds: 8, marker: [0.1, 0.2, 0.4, 0.6] },
    });
    expect(brush!.sources).toEqual([expect.objectContaining({ citation: expect.stringContaining("1299.03"), status: "in_force" })]);
    expect(fence!.sources).toEqual([expect.objectContaining({ status: "recommended", url: expect.stringMatching(/^https:\/\//) })]);
  });

  it("names each concept that was not checked once, however many clips missed it", async () => {
    const body = WalkResultsResponse.parse(await (await get(`/api/walks/${WALK}/results`)).json());
    expect(body.notChecked.filter((c) => c === "chimney")).toHaveLength(1);
  });
});

describe("GET /api/walks/{walkId}/stills/{findingId}", () => {
  it("streams the finding's own blurred still as a JPEG", async () => {
    const response = await get(stillPath(WALK, walk.brush.id));
    expect([response.status, response.headers.get("content-type")]).toEqual([200, "image/jpeg"]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(walk.stills.get(walk.brush.id));
  });
});

describe("walk reads that are not valid", () => {
  it("refuses a malformed id, an unknown walk, an unknown finding and a finding of another walk", async () => {
    await refused(await get("/api/walks/not-a-walk"), 404, "unknown_walk");
    await refused(await get(`/api/walks/${UNKNOWN}`), 404, "unknown_walk");
    await refused(await get(`/api/walks/${UNKNOWN}/results`), 404, "unknown_walk");
    await refused(await get(`/api/walks/${WALK}/stills/not-a-finding`), 404, "not_found");
    await refused(await get(stillPath(WALK, UNKNOWN)), 404, "not_found");
    const theirs = (await (await get(`/api/walks/${OTHER}/results`)).json()) as { findings: { id: string }[] };
    await refused(await get(stillPath(WALK, theirs.findings[0]!.id)), 404, "not_found");
  });

  it("answers any method but GET with 405 and allow GET", async () => {
    for (const path of [`/api/walks/${WALK}`, `/api/walks/${WALK}/results`, stillPath(WALK, walk.brush.id)]) {
      for (const method of ["POST", "PUT", "DELETE"]) {
        const response = await get(path, OWNER, method);
        expect(response.headers.get("allow")).toBe("GET");
        await refused(response, 405, "method_not_allowed");
      }
    }
  });

  it("refuses every read without the visitor header, with a malformed one, or with another visitor's", async () => {
    for (const path of [`/api/walks/${WALK}`, `/api/walks/${WALK}/results`, stillPath(WALK, walk.brush.id)]) {
      await refused(await get(path, null), 400, "invalid_request");
      await refused(await get(path, "A".repeat(64)), 400, "invalid_request");
      await refused(await get(path, STRANGER), 404, "unknown_walk");
    }
  });
});

describe("walk reads that are refused", () => {
  it("refuses results and stills of a walk that is still being checked or failed", async () => {
    for (const [state, step] of [
      ["processing", "score"],
      ["failed", "score"],
      ["queued", null],
    ] as const) {
      await env.DB.prepare("UPDATE walks SET state = ?, step = ? WHERE id = ?").bind(state, step, WALK).run();
      await refused(await get(`/api/walks/${WALK}/results`), 409, "walk_not_done");
      await refused(await get(stillPath(WALK, walk.brush.id)), 409, "walk_not_done");
    }
  });

  it("never reads a key under originals or clips, or another walk's still, from R2", async () => {
    for (const key of [`originals/${WALK}/walk.mp4`, `clips/${WALK}/loop.mp4`, `stills/${OTHER}/${walk.loop.id}/10.jpg`, `stills/${WALK}/${walk.pan.id}/10.jpg`]) {
      await env.MEDIA.put(key, new Uint8Array([1, 2, 3]));
      await setFinding(walk.brush.id, "proof_still", key);
      const bucket = spyBucket();
      const path = stillPath(WALK, walk.brush.id);
      await refused(await handleWalkRead(request(path), { DB: env.DB, MEDIA: bucket }, READ_PATH.exec(path)!), 404, "not_found");
      expect(bucket.asked).toEqual([]);
    }
  });

  it("leaves a vetoed finding out of results and never serves its still", async () => {
    const body = WalkResultsResponse.parse(await (await get(`/api/walks/${WALK}/results`)).json());
    expect(body.findings.map((f) => f.id)).not.toContain(walk.vetoed.id);
    const bucket = spyBucket();
    const path = stillPath(WALK, walk.vetoed.id);
    await refused(await handleWalkRead(request(path), { DB: env.DB, MEDIA: bucket }, READ_PATH.exec(path)!), 404, "not_found");
    expect(bucket.asked).toEqual([]);
  });

  it("refuses results whose finding names a rule not in the table, or no rule, never sending it with no source", async () => {
    for (const ruleIds of [["ca-made-up-rule-z1"], []]) {
      await setFinding(walk.brush.id, "rule_ids", JSON.stringify(ruleIds));
      await refused(await get(`/api/walks/${WALK}/results`), 500, "server_error");
    }
  });

  it("refuses results whose finding has no box on its proof frame", async () => {
    await env.DB.prepare("UPDATE findings SET proof_frame = 30, proof_still = ? WHERE id = ?").bind(`stills/${WALK}/${walk.loop.id}/30.jpg`, walk.brush.id).run();
    await refused(await get(`/api/walks/${WALK}/results`), 500, "server_error");
  });
});

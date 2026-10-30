import { env, exports } from "cloudflare:workers";
import { ErrorBody, LOOP_CONCEPTS, previewKey, previewPath, secondCheckKey, stillPath, VISITOR_HEADER, WalkResultsResponse, WalkStatusResponse } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { coverageKey } from "@emberwalk/rules";
import { addTag, completeWalk, setVoiceNotes, setWalkProgress } from "@emberwalk/db";
import { handleWalkRead, READ_PATH } from "../src/walk-read.ts";
import { emptyBucket } from "./route.ts";
import { clearWalks, type DoneWalk, OWNER, seedCoverage, seedDonePart, seedDoneWalk, seedGap, seedWalk } from "./seed.ts";

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

  it("carries the count of a processing stage, and none once the walk is done", async () => {
    const counting = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7d10";
    await seedWalk(counting, "processing", "segment");
    await setWalkProgress(env.DB, counting, 9, 13);
    const body = WalkStatusResponse.parse(await (await get(`/api/walks/${counting}`)).json());
    expect(body.state).toEqual({ name: "processing", step: "segment", progress: { done: 9, total: 13 } });
    await completeWalk(env.DB, counting);
    expect(await (await get(`/api/walks/${counting}`)).json()).toEqual({ walkId: counting, state: { name: "done" }, failure: null });
  });
});

describe("GET /api/walks/{walkId}/results", () => {
  it("gives the phone each open finding in rank order with sources, marker, seconds and what was not checked", async () => {
    const response = await get(`/api/walks/${WALK}/results`);
    expect(response.status).toBe(200);
    const body = WalkResultsResponse.parse(await response.json());
    expect(body).toMatchObject({ walkId: WALK, synthetic: true, coverage: "not_checked", gaps: [], parts: [], notChecked: ["chimney", "propane_tank"] });
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

  it("carries a finding's stored voice note, null where there is none, and never another walk's", async () => {
    const other = (await env.DB.prepare("SELECT id FROM findings WHERE walk_id = ?").bind(OTHER).first<{ id: string }>())!.id;
    expect(await setVoiceNotes(env.DB, WALK, [{ findingId: walk.brush.id, text: "The brush by the shed is dry." }])).toBe(1);
    expect(await setVoiceNotes(env.DB, OTHER, [{ findingId: other, text: "Not this walk's words." }])).toBe(1);
    const body = WalkResultsResponse.parse(await (await get(`/api/walks/${WALK}/results`)).json());
    expect(body.findings.map((f) => [f.id, f.voiceNote])).toEqual([
      [walk.fence.id, null],
      [walk.brush.id, "The brush by the shed is dry."],
    ]);
  });

  it("refuses results whose stored voice note is blank, never sending an empty note", async () => {
    await env.DB.prepare("UPDATE findings SET voice_note = ' \n ' WHERE id = ?").bind(walk.brush.id).run();
    await refused(await get(`/api/walks/${WALK}/results`), 500, "server_error");
  });

  it("names each concept that was not checked once, however many clips missed it", async () => {
    const body = WalkResultsResponse.parse(await (await get(`/api/walks/${WALK}/results`)).json());
    expect(body.notChecked.filter((c) => c === "chimney")).toHaveLength(1);
  });

  it("answers a walk where more than fifteen concepts went unchecked, naming each once", async () => {
    const pan = (await env.DB.prepare("SELECT id FROM clips WHERE walk_id = ? AND kind = 'pan'").bind(WALK).first<{ id: string }>())!.id;
    const missed = LOOP_CONCEPTS.filter((c) => c !== "wooden_fence");
    await env.DB.batch(
      missed.map((c) => env.DB.prepare("INSERT OR IGNORE INTO concept_runs (clip_id, concept, outcome, reason) VALUES (?, ?, 'not_checked', 'the clip was too dark')").bind(pan, c)),
    );
    const response = await get(`/api/walks/${WALK}/results`);
    expect(response.status).toBe(200);
    const body = WalkResultsResponse.parse(await response.json());
    expect([...body.notChecked].sort()).toEqual([...missed].sort());
  });
});

describe("results of a walk with a side that could not be checked", () => {
  const PART = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7c11";
  const LATER_PART = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7c12";
  const results = async (walkId = WALK) => WalkResultsResponse.parse(await (await get(`/api/walks/${walkId}/results`)).json());

  beforeEach(async () => {
    await seedGap(WALK, "back");
    await seedGap(WALK, "left", "dark", "more_light");
  });

  it("names each gap with its hint, in walking order, and lists no part walk yet", async () => {
    const body = await results();
    expect(body.gaps).toEqual([
      { side: "back", kind: "not_checked", hint: "again" },
      { side: "left", kind: "dark", hint: "more_light" },
    ]);
    expect(body.parts).toEqual([]);
    expect(body.findings.map((f) => f.id)).toEqual([walk.fence.id, walk.brush.id]);
  });

  it("drops the back gap once a done part walk covers the back, and adds its findings with stills under the part walk", async () => {
    const part = await seedDonePart(WALK, PART, "back", 3);
    await seedGap(PART, "back", "first_five_feet", "tilt_down");
    const body = await results();
    expect(body.gaps).toEqual([
      { side: "back", kind: "first_five_feet", hint: "tilt_down" },
      { side: "left", kind: "dark", hint: "more_light" },
    ]);
    expect(body.parts).toEqual([{ walkId: PART, side: "back" }]);
    expect(body.findings.map((f) => f.id)).toEqual([walk.fence.id, walk.brush.id, part.fence.id, part.brush.id]);
    expect(body.findings[2]!.proof.still).toBe(stillPath(PART, part.fence.id));
    const still = await get(body.findings[2]!.proof.still);
    expect(new Uint8Array(await still.arrayBuffer())).toEqual(part.stills.get(part.fence.id));
  });

  it("drops a corner's gap once a done part walk covers that corner, keeping its own gaps at that corner only, sides first", async () => {
    await seedGap(WALK, "back_left", "missing", "pan_corner");
    await seedGap(WALK, "front_right", "missing", "pan_corner");
    await seedDonePart(WALK, PART, "back_left", 3);
    await seedGap(PART, "back_left", "dark", "more_light");
    await seedGap(PART, "front", "missing", "walk_side");
    const body = await results();
    expect(body.gaps).toEqual([
      { side: "back", kind: "not_checked", hint: "again" },
      { side: "left", kind: "dark", hint: "more_light" },
      { side: "front_right", kind: "missing", hint: "pan_corner" },
      { side: "back_left", kind: "dark", hint: "more_light" },
    ]);
    expect(body.parts).toEqual([{ walkId: PART, side: "back_left" }]);
  });

  it("takes only the newest done part walk of a side, and only its gaps on that side", async () => {
    const later = await seedDonePart(WALK, PART, "back", 3);
    await seedDonePart(WALK, LATER_PART, "back", 4);
    await env.DB.prepare("UPDATE walks SET created_at = '2999-01-01T00:00:00.000Z' WHERE id = ?").bind(PART).run();
    await seedGap(PART, "front", "missing", "walk_side");
    const body = await results();
    expect(body.parts).toEqual([{ walkId: PART, side: "back" }]);
    expect(body.gaps).toEqual([{ side: "left", kind: "dark", hint: "more_light" }]);
    expect(body.findings.slice(2).map((f) => f.id)).toEqual([later.fence.id, later.brush.id]);
  });

  it("answers a part walk's own results as any walk's", async () => {
    const part = await seedDonePart(WALK, PART, "back", 3);
    const body = await results(PART);
    expect(body).toMatchObject({ walkId: PART, gaps: [], parts: [] });
    expect(body.findings.map((f) => f.id)).toEqual([part.fence.id, part.brush.id]);
  });

  it("leaves the gap in place and adds nothing while the part walk is not done, or after it failed", async () => {
    await seedDonePart(WALK, PART, "back", 3);
    for (const [state, step] of [["processing", "score"], ["failed", "segment"]] as const) {
      await env.DB.prepare("UPDATE walks SET state = ?, step = ? WHERE id = ?").bind(state, step, PART).run();
      const body = await results();
      expect(body.gaps.map((g) => g.side)).toEqual(["back", "left"]);
      expect([body.parts, body.findings.length]).toEqual([[], 2]);
    }
  });

  it("never takes in a part walk stored under another visitor", async () => {
    await seedDonePart(WALK, PART, "back", 3);
    await env.DB.prepare("UPDATE walks SET visitor_id = ? WHERE id = ?").bind(STRANGER, PART).run();
    const body = await results();
    expect([body.parts, body.findings.length, body.gaps.length]).toEqual([[], 2, 2]);
  });
});

describe("results of a walk the coverage check has looked at", () => {
  const results = async () => WalkResultsResponse.parse(await (await get(`/api/walks/${WALK}/results`)).json());
  const loopOpen = { kind: "loop_open", side: null, where: { startSeconds: 0, endSeconds: 60 }, reason: { measure: "degrees", measured: 180, needed: 330 } };
  const pansMissing = { kind: "pans_missing", side: null, where: null, reason: { measure: "pans", measured: 2, needed: 4 } };
  const everythingChecked = () => env.DB.prepare("DELETE FROM concept_runs WHERE outcome = 'not_checked'").run();

  it("says the loop is not checked, and coverage not checked, for a walk with no record", async () => {
    expect(await results()).toMatchObject({ coverage: "not_checked", loop: "not_checked", gaps: [] });
  });

  it("sends the loop the record found, and coverage not checked while the record says so", async () => {
    for (const loop of ["closed", "open", "not_checked"]) {
      await seedCoverage(WALK, { loop });
      expect(await results()).toMatchObject({ coverage: "not_checked", loop });
    }
  });

  it("sends checked only when the record says so, no gap is left and nothing was not checked", async () => {
    await everythingChecked();
    await seedCoverage(WALK, { coverage: "checked" });
    expect(await results()).toMatchObject({ coverage: "checked", loop: "closed", gaps: [], notChecked: [] });
  });

  it("brings the side gaps through the gaps line, and never says checked while one is left", async () => {
    await everythingChecked();
    await seedGap(WALK, "back", "missing", "walk_side");
    await seedCoverage(WALK, { coverage: "checked" });
    expect(await results()).toMatchObject({ coverage: "not_checked", gaps: [{ side: "back", kind: "missing", hint: "walk_side" }] });
  });

  it("never says checked for a record that says so while a concept was not checked", async () => {
    await seedCoverage(WALK, { coverage: "checked" });
    expect(await results()).toMatchObject({ coverage: "not_checked", notChecked: ["chimney", "propane_tank"] });
  });

  it("keeps the walk level gaps out of the gaps line, with coverage not checked", async () => {
    await everythingChecked();
    await seedCoverage(WALK, { loop: "open", gaps: [loopOpen, pansMissing] });
    expect(await results()).toMatchObject({ coverage: "not_checked", loop: "open", gaps: [] });
  });

  it("refuses results when the record is malformed, belongs to another walk, or says checked with a gap", async () => {
    for (const over of [{ coverage: "complete" }, { gaps: [{ kind: "smoke" }] }, { walkId: OTHER }, { coverage: "checked", gaps: [pansMissing] }]) {
      await seedCoverage(WALK, over);
      await refused(await get(`/api/walks/${WALK}/results`), 500, "server_error");
    }
    await env.MEDIA.put(coverageKey(WALK), "not json");
    await refused(await get(`/api/walks/${WALK}/results`), 500, "server_error");
  });
});

describe("pins on the drawing of the house", () => {
  const results = async () => WalkResultsResponse.parse(await (await get(`/api/walks/${WALK}/results`)).json());
  const nameLoop = (label: string) => env.DB.prepare("UPDATE tags SET label = ? WHERE walk_id = ? AND kind = 'loop'").bind(label, WALK).run();
  const loopTag = (k: number, label: string, start: number) =>
    addTag(env.DB, {
      id: `7c000000-0000-4000-8000-${String(k).padStart(12, "0")}`,
      walkId: WALK,
      kind: "loop",
      startSeconds: start,
      endSeconds: start + 30,
      label,
      samples: [{ t: start, tiltDegrees: 0, headingDegrees: 0 }],
      propertyLine: null,
    });

  it("places one pin for a loop finding on the side its proof frame falls in, at its place along that side and its near edge in feet", async () => {
    await nameLoop("back");
    const body = await results();
    expect(body.pins).toEqual([{ findingId: walk.brush.id, side: "back", band: "zone_1", position: 1 - 5 / 30, feet: 6 }]);
    expect(body.findings).toHaveLength(2);
  });

  it("measures along the side clockwise, so a walk that went the other way round lands each pin on the same spot", async () => {
    await nameLoop("back");
    expect((await results()).pins).toEqual([expect.objectContaining({ side: "back", position: 1 - 5 / 30 })]);
    await loopTag(1, "left", 33);
    expect((await results()).pins).toEqual([expect.objectContaining({ side: "back", position: 1 - 5 / 30 })]);
    await loopTag(2, "right", 63);
    await env.DB.prepare("UPDATE tags SET label = 'right' WHERE id = ?").bind(`7c000000-0000-4000-8000-${String(1).padStart(12, "0")}`).run();
    expect((await results()).pins).toEqual([expect.objectContaining({ side: "back", position: 5 / 30 })]);
  });

  it("places no pin while no loop tag names a side, for a pan finding, or for a thing 100 feet out or more, and keeps every row", async () => {
    expect((await results()).pins).toEqual([]);
    await nameLoop("back");
    await env.DB.prepare("UPDATE findings SET distance_low = 100, distance_high = 100 WHERE id = ?").bind(walk.brush.id).run();
    const body = await results();
    expect(body.pins).toEqual([]);
    expect(body.findings.map((f) => f.id)).toEqual([walk.fence.id, walk.brush.id]);
  });

  it("sends a pin as its finding, side, band, place and feet only, never a coordinate", async () => {
    await nameLoop("back");
    const body = (await (await get(`/api/walks/${WALK}/results`)).json()) as { pins: Record<string, unknown>[] };
    expect(body.pins.map((p) => Object.keys(p).sort())).toEqual([["band", "feet", "findingId", "position", "side"]]);
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

describe("See It Fixed previews and the second check", () => {
  const EDITED = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 9, 0xff, 0xd9]);
  const AGREES = { verdict: "agrees", reason: "Dead brush within 30 feet must go." };
  const FLAGS = { verdict: "flags", reason: "Metal is not required here." };
  const results = async (id = WALK) => WalkResultsResponse.parse(await (await get(`/api/walks/${id}/results`)).json());
  const byId = (body: WalkResultsResponse) => new Map(body.findings.map((f) => [f.id, f]));
  const PART = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7c21";

  it("links a finding's preview only when one was made, gives each its verdict, and streams the preview", async () => {
    await env.MEDIA.put(previewKey(WALK, walk.brush.id), EDITED);
    await env.MEDIA.put(secondCheckKey(WALK), JSON.stringify({ [walk.brush.id]: AGREES, [walk.fence.id]: FLAGS }));
    const found = byId(await results());
    expect(found.get(walk.brush.id)).toMatchObject({ preview: previewPath(WALK, walk.brush.id), secondCheck: AGREES });
    expect(found.get(walk.fence.id)).toMatchObject({ secondCheck: FLAGS });
    expect(found.get(walk.fence.id)).not.toHaveProperty("preview");
    const response = await get(previewPath(WALK, walk.brush.id));
    expect([response.status, response.headers.get("content-type")]).toEqual([200, "image/jpeg"]);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(EDITED);
  });

  it("leaves both out when neither was made", async () => {
    for (const f of (await results()).findings) {
      expect(f).not.toHaveProperty("preview");
      expect(f).not.toHaveProperty("secondCheck");
    }
  });

  it("drops a broken record or a bad entry and still answers the results", async () => {
    await env.MEDIA.put(secondCheckKey(WALK), "not json");
    expect((await results()).findings.every((f) => f.secondCheck === undefined)).toBe(true);
    await env.MEDIA.put(secondCheckKey(WALK), JSON.stringify([AGREES]));
    expect((await results()).findings.every((f) => f.secondCheck === undefined)).toBe(true);
    await env.MEDIA.put(secondCheckKey(WALK), JSON.stringify({ [walk.brush.id]: { verdict: "maybe", reason: "?" }, [walk.fence.id]: FLAGS, "not-an-id": AGREES }));
    const found = byId(await results());
    expect(found.get(walk.brush.id)?.secondCheck).toBeUndefined();
    expect(found.get(walk.fence.id)?.secondCheck).toEqual(FLAGS);
  });

  it("still answers the results when storage fails on the second check or on a preview, keeping whatever it could read", async () => {
    await env.MEDIA.put(previewKey(WALK, walk.brush.id), EDITED);
    await env.MEDIA.put(secondCheckKey(WALK), JSON.stringify({ [walk.brush.id]: AGREES }));
    const failing = (what: "get" | "head", key: string): R2Bucket =>
      Object.assign(Object.create(env.MEDIA) as R2Bucket, {
        get: async (k: string) => (what === "get" && k === key ? Promise.reject(new Error("R2 answered 503")) : env.MEDIA.get(k)),
        head: async (k: string) => (what === "head" && k === key ? Promise.reject(new Error("R2 answered 503")) : env.MEDIA.head(k)),
      });
    const path = `/api/walks/${WALK}/results`;
    const read = async (bucket: R2Bucket) => {
      const response = await handleWalkRead(request(path), { DB: env.DB, MEDIA: bucket }, READ_PATH.exec(path)!);
      expect(response.status).toBe(200);
      return byId(WalkResultsResponse.parse(await response.json())).get(walk.brush.id)!;
    };
    const noCheck = await read(failing("get", secondCheckKey(WALK)));
    expect(noCheck).not.toHaveProperty("secondCheck");
    expect(noCheck.preview).toBe(previewPath(WALK, walk.brush.id));
    const noPreview = await read(failing("head", previewKey(WALK, walk.brush.id)));
    expect(noPreview).not.toHaveProperty("preview");
    expect(noPreview.secondCheck).toEqual(AGREES);
  });

  it("serves no preview for a finding without one, a vetoed finding, another walk's finding or a stranger", async () => {
    await env.MEDIA.put(previewKey(WALK, walk.vetoed.id), EDITED);
    await env.MEDIA.put(previewKey(WALK, walk.brush.id), EDITED);
    await refused(await get(previewPath(WALK, walk.fence.id)), 404, "not_found");
    await refused(await get(previewPath(WALK, walk.vetoed.id)), 404, "not_found");
    await refused(await get(`/api/walks/${WALK}/previews/not-a-finding`), 404, "not_found");
    const theirs = (await results(OTHER)).findings[0]!.id;
    await env.MEDIA.put(previewKey(WALK, theirs), EDITED);
    await refused(await get(previewPath(WALK, theirs)), 404, "not_found");
    await refused(await get(previewPath(WALK, walk.brush.id), STRANGER), 404, "unknown_walk");
    await refused(await get(previewPath(WALK, walk.brush.id), null), 400, "invalid_request");
    await refused(await get(previewPath(WALK, walk.brush.id), OWNER, "POST"), 405, "method_not_allowed");
    await env.DB.prepare("UPDATE walks SET state = 'processing', step = 'explain' WHERE id = ?").bind(WALK).run();
    await refused(await get(previewPath(WALK, walk.brush.id)), 409, "walk_not_done");
  });

  it("links a part walk's preview and verdict under the part walk", async () => {
    const part = await seedDonePart(WALK, PART, "back", 3);
    await env.MEDIA.put(previewKey(PART, part.fence.id), EDITED);
    await env.MEDIA.put(secondCheckKey(PART), JSON.stringify({ [part.fence.id]: FLAGS }));
    const found = byId(await results()).get(part.fence.id)!;
    expect(found).toMatchObject({ preview: previewPath(PART, part.fence.id), secondCheck: FLAGS });
    expect(new Uint8Array(await (await get(found.preview!)).arrayBuffer())).toEqual(EDITED);
  });
});

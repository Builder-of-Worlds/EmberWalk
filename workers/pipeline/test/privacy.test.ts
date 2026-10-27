import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { BOX_PADDING, findPrivacy, PRIVACY_PHRASES, type PrivacyRecord, privacyKey } from "../src/privacy.ts";
import { freshWalkId, resetAll, seedClip, seedWalk } from "./fixtures.ts";
import { FRAME_HEIGHT, FRAME_WIDTH, harness, testDeps } from "./harness.ts";

const deps = () => testDeps(env, harness);

type Box = [number, number, number, number];

const person3 = { frame: 3, id: 0, box: [32, 33, 159, 166] as Box };
const person4 = { frame: 4, id: 0, box: [48, 50, 175, 183] as Box };
const plate4 = { frame: 4, id: 0, box: [100, 120, 139, 139] as Box };

const around = (left: number, top: number, right: number, bottom: number) => [
  expect.closeTo(left / FRAME_WIDTH - BOX_PADDING, 5),
  expect.closeTo(top / FRAME_HEIGHT - BOX_PADDING, 5),
  expect.closeTo(right / FRAME_WIDTH + BOX_PADDING, 5),
  expect.closeTo(bottom / FRAME_HEIGHT + BOX_PADDING, 5),
];

const setup = async (options: { synthetic?: boolean } = {}) => {
  const walkId = freshWalkId();
  await seedWalk(walkId, { state: "processing", ...(options.synthetic === undefined ? {} : { synthetic: options.synthetic }) });
  return { walkId, clip: await seedClip(walkId, 1) };
};

const readRecord = async (walkId: string, clipId: string) => (await (await env.MEDIA.get(privacyKey(walkId, clipId)))!.json()) as PrivacyRecord;

const sent = () => harness.requests.filter((r) => r.path === "/responses");

beforeEach(resetAll);

describe("findPrivacy", () => {
  it("asks SAM for each of the six phrases on the clip's own upload and records the padded regions per frame", async () => {
    const { walkId, clip } = await setup();
    harness.answers.person = [{ found: [person3, person4] }];
    harness.answers["license plate"] = [{ found: [plate4] }];

    const result = await findPrivacy(deps(), walkId, clip, "file-1");

    expect(result).toEqual({ ok: true, value: { clipId: clip.id, regions: 3, notChecked: 0 } });
    expect(sent()).toHaveLength(6);
    expect([...harness.asked].sort()).toEqual([...PRIVACY_PHRASES].sort());
    for (const request of sent()) {
      const json = ("json" in request ? request.json : {}) as { store: boolean; input: { content: { file_id?: string }[] }[] };
      expect(json.store).toBe(false);
      expect(json.input[0]?.content[1]?.file_id).toBe("file-1");
    }
    expect(harness.requests.filter((r) => r.path === "/files")).toHaveLength(0);
    const record = await readRecord(walkId, clip.id);
    expect(record.phrases.map((p) => p.status)).toEqual(Array(6).fill("checked"));
    expect(record.frames).toEqual([
      { frame: 3, regions: [around(32, 33, 160, 167)] },
      { frame: 4, regions: [around(48, 50, 176, 184), around(100, 120, 140, 140)] },
    ]);
  });

  it("checks a phrase that finds nothing and records no region for it", async () => {
    const { walkId, clip } = await setup();

    const result = await findPrivacy(deps(), walkId, clip, "file-1");

    expect(result).toEqual({ ok: true, value: { clipId: clip.id, regions: 0, notChecked: 0 } });
    expect(await readRecord(walkId, clip.id)).toEqual({ phrases: PRIVACY_PHRASES.map((phrase) => ({ phrase, status: "checked" })), frames: [] });
  });

  it("clamps a box at the frame edge to the frame", async () => {
    const { walkId, clip } = await setup();
    harness.answers.face = [{ found: [{ frame: 0, id: 0, box: [0, 0, FRAME_WIDTH - 1, FRAME_HEIGHT - 1] }] }];

    await findPrivacy(deps(), walkId, clip, "file-1");

    expect((await readRecord(walkId, clip.id)).frames).toEqual([{ frame: 0, regions: [[0, 0, 1, 1]] }]);
  });

  it("keeps all sixteen objects SAM finds on one frame", async () => {
    const { walkId, clip } = await setup();
    const crowd = Array.from({ length: 16 }, (_, id) => ({ frame: 0, id, box: [id * 10, 10, id * 10 + 9, 40] as Box }));
    harness.answers.person = [{ found: crowd }];

    const result = await findPrivacy(deps(), walkId, clip, "file-1");

    expect(result).toMatchObject({ ok: true, value: { regions: 16 } });
    expect((await readRecord(walkId, clip.id)).frames[0]?.regions).toHaveLength(16);
  });

  it("marks a phrase not_checked when SAM keeps failing on it, and still checks the rest", async () => {
    const { walkId, clip } = await setup();
    harness.answers.mailbox = [{ status: 500 }];
    harness.answers.person = [{ found: [person3] }];

    const result = await findPrivacy(deps(), walkId, clip, "file-1");

    expect(result).toEqual({ ok: true, value: { clipId: clip.id, regions: 1, notChecked: 1 } });
    const record = await readRecord(walkId, clip.id);
    expect(record.phrases.find((p) => p.phrase === "mailbox")).toEqual({ phrase: "mailbox", status: "not_checked", reason: "SAM answered 500" });
    expect(record.phrases.filter((p) => p.status === "checked")).toHaveLength(5);
    expect(harness.sleeps).toEqual([2000, 4000]);
  });

  it("refuses the whole step, sends nothing and records nothing when today's cap is reached", async () => {
    const { walkId, clip } = await setup();
    harness.capUsd = 0.001;

    expect(await findPrivacy(deps(), walkId, clip, "file-1")).toMatchObject({ ok: false, failure: { code: "spend_limit" } });
    expect(sent()).toHaveLength(0);
    expect(await env.MEDIA.head(privacyKey(walkId, clip.id))).toBeNull();
  });

  it("refuses real footage on free credits before anything is sent", async () => {
    const { walkId, clip } = await setup({ synthetic: false });

    expect(await findPrivacy(deps(), walkId, clip, "file-1")).toMatchObject({ ok: false, failure: { code: "real_footage_not_allowed" } });
    expect(sent()).toHaveLength(0);
    expect(await env.MEDIA.head(privacyKey(walkId, clip.id))).toBeNull();
  });

  it("refuses a walk that is gone", async () => {
    const { clip } = await setup();

    expect(await findPrivacy(deps(), freshWalkId(), clip, "file-1")).toMatchObject({ ok: false, failure: { code: "walk_missing" } });
  });
});

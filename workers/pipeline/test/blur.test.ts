import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { blurredStills } from "../src/blur.ts";
import { BOX_PADDING, findPrivacy, privacyKey } from "../src/privacy.ts";
import { originalKey } from "../src/storage.ts";
import { freshWalkId, resetAll, seedClip, seedOriginal, seedWalk } from "./fixtures.ts";
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

const keyOf = (url: string): string => new URL(url).pathname.slice(`/${env.R2_BUCKET_NAME}/`.length);

const setup = async () => {
  const walkId = freshWalkId();
  await seedWalk(walkId, { state: "processing" });
  await seedOriginal(walkId);
  return { walkId, clip: await seedClip(walkId, 1) };
};

const checked = async (walkId: string, clip: Awaited<ReturnType<typeof seedClip>>) => {
  harness.answers.person = [{ found: [person3, person4] }];
  harness.answers["license plate"] = [{ found: [plate4] }];
  await findPrivacy(deps(), walkId, clip, "file-1");
};

const wanted = (walkId: string, frames: number[]) => frames.map((frame) => ({ frame, output: `proofs/${walkId}/${frame}.jpg` }));

beforeEach(resetAll);

describe("blurredStills", () => {
  it("makes the wanted stills in one container call, each at its frame's time with that frame's regions", async () => {
    const { walkId, clip } = await setup();
    await checked(walkId, clip);

    const result = await blurredStills(deps(), walkId, clip, 10, wanted(walkId, [3, 4]));

    expect(result).toEqual({ ok: true, value: { stills: 2 } });
    expect(harness.stilled).toHaveLength(1);
    const request = harness.stilled[0]!;
    expect(keyOf(request.input)).toBe(originalKey(walkId));
    expect(request.stills.map((s) => s.time)).toEqual([11.5, 12]);
    expect(request.stills.map((s) => keyOf(s.output))).toEqual([`proofs/${walkId}/3.jpg`, `proofs/${walkId}/4.jpg`]);
    expect(request.stills.map((s) => s.regions)).toEqual([
      [around(32, 33, 160, 167)],
      [around(48, 50, 176, 184), around(100, 120, 140, 140)],
    ]);
    expect(await env.MEDIA.head(`proofs/${walkId}/3.jpg`)).not.toBeNull();
    expect(await env.MEDIA.head(`proofs/${walkId}/4.jpg`)).not.toBeNull();
  });

  it("sends an empty region list for a frame with nothing found on it", async () => {
    const { walkId, clip } = await setup();
    await checked(walkId, clip);

    expect(await blurredStills(deps(), walkId, clip, 0, wanted(walkId, [10]))).toEqual({ ok: true, value: { stills: 1 } });
    expect(harness.stilled[0]?.stills[0]).toMatchObject({ time: 5, regions: [] });
  });

  it("makes no call for an empty list, even with no privacy record", async () => {
    const { walkId, clip } = await setup();

    expect(await blurredStills(deps(), walkId, clip, 0, [])).toEqual({ ok: true, value: { stills: 0 } });
    expect(harness.stilled).toHaveLength(0);
  });

  it.each([60, 61, -1, 2.5])("refuses frame %s before any call and makes nothing", async (frame) => {
    const { walkId, clip } = await setup();
    await checked(walkId, clip);

    const result = await blurredStills(deps(), walkId, clip, 0, wanted(walkId, [3, frame]));

    expect(result).toMatchObject({ ok: false, failure: { code: "frame_out_of_range" } });
    expect(harness.stilled).toHaveLength(0);
    expect(await env.MEDIA.head(`proofs/${walkId}/3.jpg`)).toBeNull();
  });

  it("makes a still of the last frame of the clip", async () => {
    const { walkId, clip } = await setup();
    await checked(walkId, clip);

    expect(await blurredStills(deps(), walkId, clip, 0, wanted(walkId, [59]))).toEqual({ ok: true, value: { stills: 1 } });
    expect(harness.stilled[0]?.stills[0]?.time).toBe(29.5);
  });

  it("refuses when the privacy record is missing, asking the container nothing", async () => {
    const { walkId, clip } = await setup();

    expect(await blurredStills(deps(), walkId, clip, 0, wanted(walkId, [3]))).toMatchObject({ ok: false, failure: { code: "privacy_not_checked" } });
    expect(harness.stilled).toHaveLength(0);
    expect(await env.MEDIA.head(`proofs/${walkId}/3.jpg`)).toBeNull();
  });

  it("refuses when one phrase was not checked, asking the container nothing", async () => {
    const { walkId, clip } = await setup();
    harness.answers.mailbox = [{ status: 500 }];
    harness.answers.person = [{ found: [person3] }];
    await findPrivacy(deps(), walkId, clip, "file-1");

    expect(await blurredStills(deps(), walkId, clip, 0, wanted(walkId, [3]))).toMatchObject({ ok: false, failure: { code: "privacy_not_checked" } });
    expect(harness.stilled).toHaveLength(0);
    expect(await env.MEDIA.head(`proofs/${walkId}/3.jpg`)).toBeNull();
  });

  it("refuses a record that lists fewer than the six phrases or cannot be read", async () => {
    const { walkId, clip } = await setup();
    await env.MEDIA.put(privacyKey(walkId, clip.id), JSON.stringify({ phrases: [{ phrase: "person", status: "checked" }], frames: [] }));
    expect(await blurredStills(deps(), walkId, clip, 0, wanted(walkId, [3]))).toMatchObject({ ok: false, failure: { code: "privacy_not_checked" } });

    await env.MEDIA.put(privacyKey(walkId, clip.id), "not json");
    expect(await blurredStills(deps(), walkId, clip, 0, wanted(walkId, [3]))).toMatchObject({ ok: false, failure: { code: "privacy_not_checked" } });
    expect(harness.stilled).toHaveLength(0);
  });

  it("turns a container refusal into a media outcome", async () => {
    const { walkId, clip } = await setup();
    await checked(walkId, clip);
    harness.stills = { refuse: { code: "media_time_out_of_range", message: "A still time is past the end of the media." } };

    expect(await blurredStills(deps(), walkId, clip, 0, wanted(walkId, [3]))).toEqual({
      ok: false,
      failure: { code: "media_time_out_of_range", message: "A still time is past the end of the media." },
    });
  });

  it("throws when the container fails so the step retries", async () => {
    const { walkId, clip } = await setup();
    await checked(walkId, clip);
    harness.stills = { throws: "the media container answered 500" };

    await expect(blurredStills(deps(), walkId, clip, 0, wanted(walkId, [3]))).rejects.toThrow("500");
  });
});

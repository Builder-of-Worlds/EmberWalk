import { markFinding } from "@emberwalk/db";
import { Recheck, recheckAnswerKey, recheckPhotoKey } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { RECHECK_PHRASE, recheckFinding, recheckOutcome, RecheckRefused } from "../src/recheck-step.ts";
import { resetAll, spentNano } from "./fixtures.ts";
import { harness, testDeps } from "./harness.ts";
import { seedFindings, stillBytes } from "./writing-seed.ts";

const RECHECK = "00000000-0000-4000-8000-00000000c001";
const NOW = Date.UTC(2026, 10, 2, 17, 30);
const photoBytes = (n: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x50, n, 0xff, 0xd9]);
const dataUrl = (bytes: Uint8Array) => `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`;

const stage = (...texts: string[]) => {
  harness.answers[RECHECK_PHRASE] = texts.map((text) => ({ text }));
};

const doneFinding = async (options: { done?: boolean; photo?: number | null } = {}) => {
  const { walkId, findings } = await seedFindings(1);
  const finding = findings[0]!;
  if (options.done ?? true)
    await markFinding(env.DB, { id: crypto.randomUUID(), findingId: finding.id, status: "done", note: "", doneOn: "2026-11-01", markedAt: "2026-11-01T18:00:00.000Z" });
  const photo = options.photo === undefined ? 1 : options.photo;
  if (photo !== null) await env.MEDIA.put(recheckPhotoKey(walkId, finding.id, RECHECK), photoBytes(photo), { httpMetadata: { contentType: "image/jpeg" } });
  return { walkId, finding };
};

const storedAnswer = async (walkId: string, findingId: string) => {
  const object = await env.MEDIA.get(recheckAnswerKey(walkId, findingId, RECHECK));
  return object === null ? null : Recheck.parse(await object.json());
};

const asked = () => harness.requests.filter((r) => r.path === "/responses");

const imagesSent = () => {
  const body = asked().at(-1);
  const content = body !== undefined && "json" in body ? (body.json as { input: { content: { type: string; image_url?: string }[] }[] }).input[0]!.content : [];
  return content.filter((c) => c.type === "input_image").map((c) => c.image_url);
};

describe("recheckFinding", () => {
  beforeEach(resetAll);

  for (const result of ["cleared", "still_there", "unsure"] as const) {
    it(`stores a ${result} answer for a Done finding, judged from the walk's still and the new photo`, async () => {
      const { walkId, finding } = await doneFinding({ photo: result.length });
      stage(JSON.stringify({ result }));

      const answer = await recheckFinding(testDeps(env, harness), finding.id, RECHECK, () => NOW);

      const expected = { id: RECHECK, findingId: finding.id, photo: recheckPhotoKey(walkId, finding.id, RECHECK), result, createdAt: new Date(NOW).toISOString() };
      expect(answer).toEqual(expected);
      expect(await storedAnswer(walkId, finding.id)).toEqual(expected);
      expect(imagesSent()).toEqual([dataUrl(stillBytes(1)), dataUrl(photoBytes(result.length))]);
      expect(await spentNano()).toBeGreaterThan(0);
    });
  }

  it("answers the stored answer again without asking Meta twice", async () => {
    const { walkId, finding } = await doneFinding();
    stage(JSON.stringify({ result: "cleared" }), JSON.stringify({ result: "still_there" }));
    const first = await recheckFinding(testDeps(env, harness), finding.id, RECHECK, () => NOW);

    expect(await recheckFinding(testDeps(env, harness), finding.id, RECHECK, () => NOW + 60_000)).toEqual(first);
    expect(asked()).toHaveLength(1);
    expect((await storedAnswer(walkId, finding.id))?.result).toBe("cleared");
  });

  it("never overwrites an answer another judge stored while Meta was asked, and answers that first answer", async () => {
    const { walkId, finding } = await doneFinding();
    stage(JSON.stringify({ result: "still_there" }));
    const first = { id: RECHECK, findingId: finding.id, photo: recheckPhotoKey(walkId, finding.id, RECHECK), result: "cleared", createdAt: new Date(NOW - 1000).toISOString() };
    const deps = testDeps(env, harness);
    const meta = deps.meta;
    deps.meta = () => {
      const client = meta();
      const call = client.call.bind(client);
      client.call = (async (request: Parameters<typeof call>[0]) => {
        await env.MEDIA.put(recheckAnswerKey(walkId, finding.id, RECHECK), JSON.stringify(first));
        return call(request);
      }) as typeof client.call;
      return client;
    };

    expect(await recheckFinding(deps, finding.id, RECHECK, () => NOW)).toEqual(first);
    expect(await storedAnswer(walkId, finding.id)).toEqual(first);
    expect(asked()).toHaveLength(1);
  });

  it("refuses a finding that is not Done, a missing photo and an unknown finding, and asks Meta nothing", async () => {
    const notDone = await doneFinding({ done: false });
    await expect(recheckFinding(testDeps(env, harness), notDone.finding.id, RECHECK)).rejects.toMatchObject({ code: "not_done" });
    const noPhoto = await doneFinding({ photo: null });
    await expect(recheckFinding(testDeps(env, harness), noPhoto.finding.id, RECHECK)).rejects.toMatchObject({ code: "no_photo" });
    await expect(recheckFinding(testDeps(env, harness), "00000000-0000-4000-8000-0000000000ff", RECHECK)).rejects.toBeInstanceOf(RecheckRefused);
    await expect(recheckFinding(testDeps(env, harness), "not-an-id", RECHECK)).rejects.toMatchObject({ code: "unknown_finding" });
    await expect(recheckFinding(testDeps(env, harness), noPhoto.finding.id, "../x")).rejects.toMatchObject({ code: "unknown_finding" });
    expect(asked()).toEqual([]);
    expect(await storedAnswer(notDone.walkId, notDone.finding.id)).toBeNull();
  });

  it("refuses a finding that was vetoed, even marked Done, and asks Meta nothing", async () => {
    const { walkId, finding } = await doneFinding();
    await env.DB.prepare("UPDATE findings SET veto_reason = ? WHERE id = ?").bind("The brush is green.", finding.id).run();
    stage(JSON.stringify({ result: "cleared" }));

    await expect(recheckFinding(testDeps(env, harness), finding.id, RECHECK, () => NOW)).rejects.toMatchObject({ code: "unknown_finding" });
    expect(asked()).toEqual([]);
    expect(await storedAnswer(walkId, finding.id)).toBeNull();
  });

  it("stores nothing when Meta answers outside the three answers", async () => {
    const { walkId, finding } = await doneFinding();
    stage(JSON.stringify({ result: "gone" }));

    await expect(recheckFinding(testDeps(env, harness), finding.id, RECHECK)).rejects.toThrow();
    expect(await storedAnswer(walkId, finding.id)).toBeNull();
  });

  it("answers the service binding with the recheck, the refusal or the failure, never a throw", async () => {
    const { finding } = await doneFinding();
    stage(JSON.stringify({ result: "still_there" }));
    expect(await recheckOutcome(testDeps(env, harness), finding.id, RECHECK)).toMatchObject({ recheck: { result: "still_there" } });
    expect(await recheckOutcome(testDeps(env, harness), "not-an-id", RECHECK)).toEqual({ refused: "unknown_finding" });
    const other = await doneFinding();
    await env.MEDIA.delete(other.finding.proofFrame.still);
    expect(await recheckOutcome(testDeps(env, harness), other.finding.id, RECHECK)).toEqual({ failed: `the proof still of finding ${other.finding.id} is missing` });
  });
});

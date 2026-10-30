import { fixPrompt, museImageEditCall } from "@emberwalk/meta";
import { previewKey } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Deps, depsFrom } from "../src/deps.ts";
import type { Env } from "../src/env.ts";
import { jpegDataUrl, previewWalk } from "../src/preview-step.ts";
import { resetAll, spentNano } from "./fixtures.ts";
import { harness, testDeps } from "./harness.ts";
import { clientOn, json, scripted, seedFindings, sentJson, stillBytes } from "./writing-seed.ts";

const EDITED = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 7, 7, 0xff, 0xd9]);
const edited = () => json(200, { created: 1, data: [{ b64_json: btoa(String.fromCharCode(...EDITED)) }] });
const dataUrl = (bytes: Uint8Array) => `data:image/jpeg;base64,${btoa(String.fromCharCode(...bytes))}`;

const withMeta = (museImage: Deps["museImage"]): Deps => ({ ...testDeps(env, harness), museImage });

const stored = async (key: string) => {
  const object = await env.MEDIA.get(key);
  return object === null ? null : { bytes: new Uint8Array(await object.arrayBuffer()), type: object.httpMetadata?.contentType };
};

describe("previewWalk", () => {
  beforeEach(resetAll);

  it("previews the top 3 kept findings by rank from their blurred stills, one cent each", async () => {
    const { walkId, findings } = await seedFindings(5, { vetoRank: 2 });
    const fake = scripted(edited);

    expect(await previewWalk(withMeta(() => clientOn(fake.transport)), walkId)).toEqual({ made: 3, failed: 0 });

    const top = [findings[0]!, findings[2]!, findings[3]!];
    expect(fake.requests.map((r) => r.path)).toEqual(["/images/edits", "/images/edits", "/images/edits"]);
    expect(fake.requests.map((r) => (sentJson(r)["images"] as { image_url: string }[])[0]?.image_url)).toEqual(top.map((f) => dataUrl(stillBytes(f.rank))));
    expect(fake.requests.map((r) => sentJson(r)["prompt"])).toEqual(top.map((f) => fixPrompt(f.concept, f.instruction)));
    for (const f of top) expect(await stored(previewKey(walkId, f.id))).toEqual({ bytes: EDITED, type: "image/jpeg" });
    expect(await stored(previewKey(walkId, findings[1]!.id))).toBeNull();
    expect(await stored(previewKey(walkId, findings[4]!.id))).toBeNull();
    expect(await spentNano()).toBe(30_000_000);
  });

  it("keeps going past a blocked edit and a missing still, and fails nothing", async () => {
    const { walkId, findings } = await seedFindings(3, { noStillRank: 2 });
    let n = 0;
    const fake = scripted(() => (++n === 1 ? json(400, { error: { code: "content_policy_violation" } }) : edited()));

    expect(await previewWalk(withMeta(() => clientOn(fake.transport)), walkId)).toEqual({ made: 1, failed: 2 });
    expect(fake.requests).toHaveLength(2);
    expect(await stored(previewKey(walkId, findings[0]!.id))).toBeNull();
    expect(await stored(previewKey(walkId, findings[2]!.id))).not.toBeNull();
    expect(await spentNano()).toBe(10_000_000);
  });

  it("sends nothing from a real walk on free credits", async () => {
    const { walkId, findings } = await seedFindings(2, { synthetic: false });
    const fake = scripted(edited);

    expect(await previewWalk(withMeta(() => clientOn(fake.transport)), walkId)).toEqual({ made: 0, failed: 2 });
    expect(fake.requests).toEqual([]);
    expect(await stored(previewKey(walkId, findings[0]!.id))).toBeNull();
  });

  it("previews a real walk once billing is paid", async () => {
    const { walkId } = await seedFindings(1, { synthetic: false });
    const fake = scripted(edited);

    expect(await previewWalk(withMeta(() => clientOn(fake.transport, "paid")), walkId)).toEqual({ made: 1, failed: 0 });
  });

  it("stops at the daily cap", async () => {
    const { walkId } = await seedFindings(3);
    const fake = scripted(edited);

    expect(await previewWalk(withMeta(() => clientOn(fake.transport, "free_credits", 0.015)), walkId)).toEqual({ made: 1, failed: 2 });
    expect(fake.requests).toHaveLength(1);
  });

  it("answers without throwing when the server has no Meta key or the walk is gone", async () => {
    const { walkId } = await seedFindings(2);
    const noKey = withMeta(() => {
      throw new Error("the Meta API key is not set up on this server");
    });
    expect(await previewWalk(noKey, walkId)).toEqual({ made: 0, failed: 2 });
    expect(await previewWalk(noKey, "00000000-0000-4000-8000-00000000dead")).toEqual({ made: 0, failed: 1 });
  });

  it("does nothing for a walk with no kept findings", async () => {
    const { walkId } = await seedFindings(1, { vetoRank: 1 });
    const fake = scripted(edited);
    expect(await previewWalk(withMeta(() => clientOn(fake.transport)), walkId)).toEqual({ made: 0, failed: 0 });
    expect(fake.requests).toEqual([]);
  });

  it("stops asking once its time is spent and keeps the previews already made", async () => {
    const { walkId, findings } = await seedFindings(3);
    let clock = 0;
    const fake = scripted(() => ((clock += 1000), edited()));

    expect(await previewWalk(withMeta(() => clientOn(fake.transport)), walkId, 2000, () => clock)).toEqual({ made: 2, failed: 0 });
    expect(fake.requests).toHaveLength(2);
    expect(await stored(previewKey(walkId, findings[1]!.id))).not.toBeNull();
    expect(await stored(previewKey(walkId, findings[2]!.id))).toBeNull();
  });

  it("starts no preview four minutes in, well inside the step's fifteen", async () => {
    const { walkId } = await seedFindings(3);
    let clock = 0;
    const fake = scripted(() => ((clock += 120_000), edited()));

    expect(await previewWalk(withMeta(() => clientOn(fake.transport)), walkId, undefined, () => clock)).toEqual({ made: 2, failed: 0 });
  });
});

describe("the Muse Image client", () => {
  beforeEach(resetAll);
  afterEach(() => vi.restoreAllMocks());

  it("gives every Muse Image call a ninety second limit, and leaves the other Meta calls unlimited", async () => {
    const signals: (AbortSignal | null)[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      signals.push(init?.signal ?? null);
      return Response.json({ created: 1, data: [{ b64_json: btoa(String.fromCharCode(...EDITED)) }] });
    });
    const timeouts = vi.spyOn(AbortSignal, "timeout");
    const deps = depsFrom({ ...env, META_API_KEY: "test-key" } as Env);
    const call = (prompt: string) => museImageEditCall({ prompt, image: dataUrl(EDITED), content: "synthetic", walkId: null });

    await deps.museImage().call(call("Clear the brush."));
    await deps.meta().call(call("Move the woodpile."));

    expect(timeouts.mock.calls).toEqual([[90_000]]);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBeNull();
  });
});

describe("jpegDataUrl", () => {
  beforeEach(resetAll);

  it("reads a still larger than one chunk byte for byte, and answers null for a missing one", async () => {
    const big = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31) % 256);
    await env.MEDIA.put("stills/big.jpg", big);
    const url = (await jpegDataUrl(env.MEDIA, "stills/big.jpg"))!;
    expect(url.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(Uint8Array.from(atob(url.slice(23)), (c) => c.charCodeAt(0))).toEqual(big);
    expect(await jpegDataUrl(env.MEDIA, "stills/none.jpg")).toBeNull();
  });
});

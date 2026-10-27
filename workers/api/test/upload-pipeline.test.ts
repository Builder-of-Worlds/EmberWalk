import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.ts";
import type { Env } from "../src/index.ts";
import { MiB, PART_BYTES, emptyBucket, start, uploadAll } from "./route.ts";
import { clearWalks, seedWalk, walkState } from "./seed.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const TOTAL = PART_BYTES + MiB;

type Pipeline = Env["PIPELINE_SERVICE"];
type Parts = { partNumber: number; etag: string }[];

let calls: string[];
let warnings: string[];

const recording = (answer: () => Promise<{ started: boolean; reason?: string }>): Pipeline => ({
  start: async (walkId: string) => {
    calls.push(`${walkId} while ${await walkState(walkId)}`);
    return answer();
  },
});

const complete = async (uploadId: string, parts: Parts, over: Partial<Env>) => {
  const request = new Request<unknown, IncomingRequestCfProperties>("https://api.test/api/uploads/complete", {
    method: "POST",
    body: JSON.stringify({ uploadId, parts }),
  });
  const response = await worker.fetch(request, { ...env, ...over });
  return { status: response.status, json: (await response.json()) as Record<string, unknown> };
};

const readyToComplete = async (): Promise<{ uploadId: string; parts: Parts }> => {
  const { uploadId } = (await start(WALK, TOTAL)).json;
  return { uploadId, parts: await uploadAll(uploadId, TOTAL) };
};

const failingQueue = (): Env["DB"] =>
  ({
    prepare: (sql: string) => {
      if (sql.startsWith("UPDATE walks")) throw new Error("D1 is down");
      return env.DB.prepare(sql);
    },
  }) as unknown as Env["DB"];

beforeEach(async () => {
  await emptyBucket();
  await clearWalks();
  await seedWalk(WALK, "uploading");
  calls = [];
  warnings = [];
  vi.spyOn(console, "warn").mockImplementation((line: string) => {
    warnings.push(line);
  });
});

describe("completing an upload starts the pipeline", () => {
  it("calls the pipeline once with the walk id, after the walk is queued", async () => {
    const { uploadId, parts } = await readyToComplete();
    const reply = await complete(uploadId, parts, { PIPELINE_SERVICE: recording(async () => ({ started: true })) });
    expect([reply.status, reply.json]).toEqual([200, { walkId: WALK, bytes: TOTAL }]);
    expect(calls).toEqual([`${WALK} while queued`]);
    expect(warnings).toEqual([]);
  });

  it("answers the same when the pipeline says it did not start, and logs why", async () => {
    const { uploadId, parts } = await readyToComplete();
    const reply = await complete(uploadId, parts, {
      PIPELINE_SERVICE: recording(async () => ({ started: false, reason: "already_started" })),
    });
    expect([reply.status, reply.json]).toEqual([200, { walkId: WALK, bytes: TOTAL }]);
    expect(calls).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(WALK);
    expect(warnings[0]).toContain("already_started");
    expect(await walkState(WALK)).toBe("queued");
  });

  it("answers the same when the pipeline call throws, and logs it", async () => {
    const { uploadId, parts } = await readyToComplete();
    const reply = await complete(uploadId, parts, {
      PIPELINE_SERVICE: recording(async () => {
        throw new Error("service unreachable");
      }),
    });
    expect([reply.status, reply.json]).toEqual([200, { walkId: WALK, bytes: TOTAL }]);
    expect(calls).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(WALK);
    expect(warnings[0]).toContain("service unreachable");
    expect(await walkState(WALK)).toBe("queued");
  });

  it("does not call the pipeline when the parts are refused", async () => {
    const { uploadId, parts } = await readyToComplete();
    const reply = await complete(uploadId, parts.slice(0, 1), { PIPELINE_SERVICE: recording(async () => ({ started: true })) });
    expect(reply.status).toBe(422);
    expect(calls).toEqual([]);
    expect(await walkState(WALK)).toBe("uploading");
  });

  it("does not call the pipeline a second time for an upload that is already finished", async () => {
    const { uploadId, parts } = await readyToComplete();
    const pipeline = recording(async () => ({ started: true }));
    await complete(uploadId, parts, { PIPELINE_SERVICE: pipeline });
    const again = await complete(uploadId, parts, { PIPELINE_SERVICE: pipeline });
    expect([again.status, (again.json.error as { code: string }).code]).toEqual([409, "upload_completed"]);
    expect(calls).toHaveLength(1);
  });
});

describe("when queueing the walk fails", () => {
  it("does not call the pipeline, and a retry queues the walk and starts it once", async () => {
    const { uploadId, parts } = await readyToComplete();
    const pipeline = recording(async () => ({ started: true }));
    await expect(complete(uploadId, parts, { DB: failingQueue(), PIPELINE_SERVICE: pipeline })).rejects.toThrow("D1 is down");
    expect(calls).toEqual([]);
    expect(await walkState(WALK)).toBe("uploading");

    const retry = await complete(uploadId, parts, { PIPELINE_SERVICE: pipeline });
    expect([retry.status, retry.json]).toEqual([200, { walkId: WALK, bytes: TOTAL }]);
    expect(calls).toEqual([`${WALK} while queued`]);
    expect(await walkState(WALK)).toBe("queued");
  });

  it("still refuses a finished upload whose walk has moved on", async () => {
    const { uploadId, parts } = await readyToComplete();
    await expect(complete(uploadId, parts, { DB: failingQueue() })).rejects.toThrow();
    await env.DB.prepare("UPDATE walks SET state = 'recording' WHERE id = ?").bind(WALK).run();
    const retry = await complete(uploadId, parts, { PIPELINE_SERVICE: recording(async () => ({ started: true })) });
    expect([retry.status, (retry.json.error as { code: string }).code]).toEqual([409, "upload_completed"]);
    expect(calls).toEqual([]);
  });
});

import { env } from "cloudflare:workers";
import { addGap, approveMessage, d1Ledger, markSent, recordStepTime } from "@emberwalk/db";
import { type CostRecord, DEFAULT_LIMITS, type Part, limitsWith } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { readOps } from "../src/ops-data.ts";
import { clearWalks, seedWalk } from "./seed.ts";

const DAY = "2026-10-30";
const WALK = (n: number): string => `6f0d3f1e-5a64-4c0e-9d57-${String(n).padStart(12, "0")}`;
const COST = (n: number): string => `9c0d3f1e-5a64-4c0e-9d57-${String(n).padStart(12, "0")}`;

const cost = async (n: number, day: string, totalUsd: number, cached = false, step: CostRecord["step"] = "segment"): Promise<void> => {
  await d1Ledger(env.DB).record({
    id: COST(n),
    at: `${day}T12:00:00.000Z`,
    model: "muse-spark",
    step,
    walkId: null,
    units: { kind: "frames", count: 10 },
    unitPriceUsd: totalUsd / 10,
    totalUsd,
    cached,
  });
};

const dated = async (id: string, day: string): Promise<void> => {
  await env.DB.prepare("UPDATE walks SET created_at = ? WHERE id = ?").bind(`${day}T09:00:00.000Z`, id).run();
};

const fail = async (id: string, code: string, message = "plain words"): Promise<void> => {
  await env.DB.prepare("UPDATE walks SET failure_code = ?, failure_message = ? WHERE id = ?").bind(code, message, id).run();
};

const message = async (n: number, jobId: string, crewId: string, channel: string, status: string, sentAt: string | null): Promise<void> => {
  const id = `5e0d3f1e-5a64-4c0e-9d57-${String(n).padStart(12, "0")}`;
  const subject = channel === "email" ? "Quote request" : null;
  await env.DB.prepare("INSERT INTO agent_messages (id, job_id, crew_id, channel, status, subject, body, created_at) VALUES (?, ?, ?, ?, 'draft', ?, 'Hello', ?)")
    .bind(id, jobId, crewId, channel, subject, `${DAY}T08:00:00.000Z`)
    .run();
  if (status === "draft") return;
  await approveMessage(env.DB, id, `${DAY}T08:30:00.000Z`, { visitorId: "a".repeat(64), photoKeys: ["stills/a.jpg"] });
  if (status === "approved") return;
  await markSent(env.DB, id, sentAt ?? "", status === "sent_by_phone" ? "sent_by_phone" : "sent");
  if (status === "replied") await env.DB.prepare("UPDATE agent_messages SET status = 'replied' WHERE id = ?").bind(id).run();
};

const job = async (walkId: string): Promise<{ jobId: string; crewId: string }> => {
  const jobId = `4a0d3f1e-5a64-4c0e-9d57-${walkId.slice(-12)}`;
  const crewId = `3b0d3f1e-5a64-4c0e-9d57-${walkId.slice(-12)}`;
  await env.DB.prepare("INSERT INTO agent_jobs (id, walk_id, trade, finding_ids, zip, status, created_at, updated_at) VALUES (?, ?, 'tree_service', '[\"a\"]', '95000', 'planning', ?, ?)")
    .bind(jobId, walkId, `${DAY}T08:00:00.000Z`, `${DAY}T08:00:00.000Z`)
    .run();
  await env.DB.prepare("INSERT INTO agent_job_crews (job_id, crew_id, position, crew) VALUES (?, ?, 1, '{}')").bind(jobId, crewId).run();
  return { jobId, crewId };
};

beforeEach(async () => {
  await clearWalks();
  await env.DB.prepare("DELETE FROM cost_records").run();
});

describe("the spend figure", () => {
  it("is the ledger sum of the day against the cap, and leaves other days out", async () => {
    await cost(1, DAY, 3);
    await cost(2, DAY, 2);
    await cost(3, "2026-10-29", 7);
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect([data.spentUsd, data.capUsd, data.percent, data.overCap]).toEqual([5, 20, 25, false]);
  });

  it("adds nothing for a cached answer", async () => {
    await cost(1, DAY, 4);
    await cost(2, DAY, 0, true);
    expect((await readOps(env.DB, DAY, DEFAULT_LIMITS)).spentUsd).toBe(4);
  });

  it("takes the cap from the limits it is given", async () => {
    await cost(1, DAY, 5);
    const data = await readOps(env.DB, DAY, limitsWith({ dailySpendUsd: 8 }));
    expect([data.capUsd, data.percent]).toEqual([8, 63]);
  });

  it("never reads 100 percent while under the cap", async () => {
    await cost(1, DAY, 19.95);
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect([data.percent, data.overCap]).toEqual([99, false]);
  });

  it("reads exactly 100 at the cap", async () => {
    await cost(1, DAY, 20);
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect([data.percent, data.overCap]).toEqual([100, true]);
  });

  it("reads a whole percent when the spend is a whole percent of the cap", async () => {
    await cost(1, DAY, 5.8);
    expect((await readOps(env.DB, DAY, DEFAULT_LIMITS)).percent).toBe(29);
  });

  it("reads over only at the cap or past it, and does not clamp the percent", async () => {
    const limits = limitsWith({ dailySpendUsd: 10 });
    await cost(1, DAY, 9.99);
    expect((await readOps(env.DB, DAY, limits)).overCap).toBe(false);
    await cost(2, DAY, 0.01);
    expect((await readOps(env.DB, DAY, limits)).overCap).toBe(true);
    await cost(3, DAY, 15);
    const data = await readOps(env.DB, DAY, limits);
    expect([data.spentUsd, data.percent, data.overCap]).toEqual([25, 250, true]);
  });
});

describe("walks of the day", () => {
  it("counts every state, zero when there are none, and only walks created that day", async () => {
    await seedWalk(WALK(1), "done");
    await seedWalk(WALK(2), "done");
    await seedWalk(WALK(3), "uploading");
    await seedWalk(WALK(4), "processing", "score");
    await seedWalk(WALK(5), "failed", "segment");
    await seedWalk(WALK(6), "done");
    for (const n of [1, 2, 3, 4, 5]) await dated(WALK(n), DAY);
    await dated(WALK(6), "2026-10-29");
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect(data.walksByState).toEqual({ recording: 0, uploading: 1, queued: 0, processing: 1, done: 2, failed: 1 });
  });

  it("gives zeros and empty lists on empty tables", async () => {
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect(data).toEqual({
      day: DAY,
      spentUsd: 0,
      capUsd: 20,
      percent: 0,
      overCap: false,
      walksByState: { recording: 0, uploading: 0, queued: 0, processing: 0, done: 0, failed: 0 },
      spendByStep: [],
      stepTimes: [],
      failed: [],
      notChecked: [],
      notCheckedParts: 0,
      queue: { queued: 0, processing: 0 },
      emails: { sentToday: 0, approvedWaiting: 0 },
    });
  });
});

describe("failed walks", () => {
  it("shows the walk id, the step, the code and the message, and the side for a walk that is a part of another", async () => {
    await seedWalk(WALK(1), "done");
    await seedWalk(WALK(2), "failed", "second_check");
    await seedWalk(WALK(3), "failed", "segment");
    await env.DB.prepare("INSERT INTO walk_parts (walk_id, part_of, part) VALUES (?, ?, 'front_right')").bind(WALK(3), WALK(1)).run();
    await fail(WALK(2), "meta_unavailable", "Meta did not answer in time");
    await fail(WALK(3), "no_frames");
    for (const n of [1, 2, 3]) await dated(WALK(n), DAY);
    await env.DB.prepare("UPDATE walks SET created_at = ? WHERE id = ?").bind(`${DAY}T10:00:00.000Z`, WALK(3)).run();
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect(data.failed).toEqual([
      { walkId: WALK(3), step: "segment", code: "no_frames", message: "plain words", side: "front_right" },
      { walkId: WALK(2), step: "second_check", code: "meta_unavailable", message: "Meta did not answer in time", side: null },
    ]);
  });

  it("gives no message for a failed walk that has none", async () => {
    await seedWalk(WALK(1), "failed", "prepare");
    await dated(WALK(1), DAY);
    expect((await readOps(env.DB, DAY, DEFAULT_LIMITS)).failed[0]?.message).toBeNull();
  });

  it("leaves out a failed walk of another day and names an unset code", async () => {
    await seedWalk(WALK(1), "failed", "prepare");
    await seedWalk(WALK(2), "failed", "score");
    await dated(WALK(1), "2026-10-29");
    await dated(WALK(2), DAY);
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect(data.failed).toEqual([{ walkId: WALK(2), step: "score", code: "unknown", message: null, side: null }]);
  });

  it("lists the newest 50 and still counts them all", async () => {
    for (let n = 1; n <= 53; n += 1) {
      await seedWalk(WALK(n), "failed", "prepare");
      await env.DB.prepare("UPDATE walks SET created_at = ? WHERE id = ?").bind(`${DAY}T10:${String(n).padStart(2, "0")}:00.000Z`, WALK(n)).run();
    }
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect(data.walksByState.failed).toBe(53);
    expect(data.failed).toHaveLength(50);
    expect(data.failed[0]?.walkId).toBe(WALK(53));
    expect(data.failed.at(-1)?.walkId).toBe(WALK(4));
  });
});

describe("spend per step", () => {
  it("adds the day's cost of each step, the dearest step first, and leaves other days out", async () => {
    await cost(1, DAY, 3, false, "segment");
    await cost(2, DAY, 2, false, "segment");
    await cost(3, DAY, 4, false, "explain");
    await cost(4, DAY, 0.5, false, "score");
    await cost(5, "2026-10-29", 9, false, "score");
    await cost(6, DAY, 0, true, "transcribe");
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect(data.spendByStep).toEqual([
      { step: "segment", usd: 5 },
      { step: "explain", usd: 4 },
      { step: "score", usd: 0.5 },
      { step: "transcribe", usd: 0 },
    ]);
    expect(data.spendByStep.reduce((sum, row) => sum + row.usd, 0)).toBeCloseTo(data.spentUsd, 9);
  });
});

describe("parts left not checked", () => {
  const gap = (walkId: string, side: Part): Promise<void> => addGap(env.DB, walkId, { side, kind: "not_checked", hint: "again" });

  it("lists the walk and side of each not checked gap of a walk created that day", async () => {
    await seedWalk(WALK(1), "done");
    await seedWalk(WALK(2), "done");
    await seedWalk(WALK(3), "done");
    await seedWalk(WALK(4), "done");
    for (const n of [1, 2, 3]) await dated(WALK(n), DAY);
    await dated(WALK(4), "2026-10-29");
    await gap(WALK(1), "front");
    await gap(WALK(1), "back_left");
    await gap(WALK(2), "right");
    await gap(WALK(4), "left");
    await addGap(env.DB, WALK(3), { side: "front", kind: "dark", hint: "more_light" });
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect(data.notChecked).toEqual([
      { walkId: WALK(1), side: "back_left" },
      { walkId: WALK(1), side: "front" },
      { walkId: WALK(2), side: "right" },
    ]);
    expect(data.notCheckedParts).toBe(3);
  });

  it("lists at most 50 and still counts every part", async () => {
    for (let n = 1; n <= 52; n += 1) {
      await seedWalk(WALK(n), "done");
      await dated(WALK(n), DAY);
      await gap(WALK(n), "front");
    }
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect(data.notChecked).toHaveLength(50);
    expect(data.notCheckedParts).toBe(52);
  });
});

describe("the queue", () => {
  it("counts walks waiting and running now, whatever day they began", async () => {
    await seedWalk(WALK(1), "queued");
    await seedWalk(WALK(2), "queued");
    await seedWalk(WALK(3), "processing", "score");
    await seedWalk(WALK(4), "done");
    await dated(WALK(1), "2026-10-27");
    await dated(WALK(2), DAY);
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect(data.queue).toEqual({ queued: 2, processing: 1 });
  });
});

describe("email sends", () => {
  it("counts emails sent that day and approved ones still waiting, and nothing else", async () => {
    await seedWalk(WALK(1), "done");
    const { jobId, crewId } = await job(WALK(1));
    await message(1, jobId, crewId, "email", "sent", `${DAY}T14:00:00.000Z`);
    await message(2, jobId, crewId, "email", "replied", `${DAY}T15:00:00.000Z`);
    await message(3, jobId, crewId, "email", "sent", "2026-10-29T14:00:00.000Z");
    await message(4, jobId, crewId, "email", "sent_by_phone", `${DAY}T16:00:00.000Z`);
    await message(5, jobId, crewId, "text", "sent", `${DAY}T17:00:00.000Z`);
    await message(6, jobId, crewId, "email", "approved", null);
    await message(7, jobId, crewId, "email", "draft", null);
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect(data.emails).toEqual({ sentToday: 2, approvedWaiting: 1 });
  });
});

describe("the time per step", () => {
  const timed = async (walkId: string, step: string, day: string, ms: number): Promise<void> => {
    await recordStepTime(env.DB, { walkId, step, startedAt: `${day}T10:00:00.000Z`, ms });
  };

  it("is the median of the day's runs of each step, slowest first, and leaves other days out", async () => {
    await seedWalk(WALK(1), "done");
    await seedWalk(WALK(2), "done");
    for (const ms of [300, 100, 200]) await timed(WALK(1), "store", DAY, ms);
    for (const ms of [4000, 1000]) await timed(WALK(1), "segment loop", DAY, ms);
    await timed(WALK(2), "segment loop", DAY, 2000);
    await timed(WALK(2), "segment loop", DAY, 9000);
    await timed(WALK(2), "store", "2026-10-29", 99_000);
    await timed(WALK(2), "prepare", "2026-10-31", 7);
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect(data.stepTimes).toEqual([
      { step: "segment loop", medianMs: 3000, runs: 4 },
      { step: "store", medianMs: 200, runs: 3 },
    ]);
  });

  it("is empty, not an error, when no step was timed that day", async () => {
    const data = await readOps(env.DB, DAY, DEFAULT_LIMITS);
    expect(data.stepTimes).toEqual([]);
  });
});

describe("a read", () => {
  it("runs only SELECT statements", async () => {
    const seen: string[] = [];
    const watching = new Proxy(env.DB, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            seen.push(sql);
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property) as unknown;
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    await readOps(watching, DAY, DEFAULT_LIMITS);
    expect(seen.length).toBeGreaterThanOrEqual(5);
    for (const sql of seen) expect(sql.trimStart().toUpperCase().startsWith("SELECT")).toBe(true);
  });
});

import type { WalkState, WalkStatusResponse } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import type { Answer } from "../../src/api.ts";
import { HELD_RETRY_MS, POLL_MS, SIGNAL_RETRY_MS, watchWalk } from "../../src/watch.ts";
import type { Online, Watched } from "../../src/watch.ts";
import { fakeClock } from "./fakes.ts";

const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b01";

const at = (state: WalkState, message: string | null = null): Answer<WalkStatusResponse> => ({
  value: { walkId: WALK, state, failure: message === null ? null : { code: "pipeline_failed", message } },
});

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

const fakeOnline = (signal = false) => {
  let waiting: (() => void)[] = [];
  const online: Online = {
    isOnline: () => signal,
    onOnline: (run) => {
      waiting.push(run);
      return () => {
        waiting = waiting.filter((w) => w !== run);
      };
    },
  };
  const fire = () => {
    const due = waiting;
    waiting = [];
    for (const run of due) run();
  };
  return { online, fire, listening: () => waiting.length };
};

const watching = async (answers: Answer<WalkStatusResponse>[], signal = false) => {
  const time = fakeClock();
  const net = fakeOnline(signal);
  const asked: number[] = [];
  const seen: Watched[] = [];
  const status = async (walkId: string) => {
    expect(walkId).toBe(WALK);
    asked.push(time.clock.now());
    return answers.shift() ?? { code: "server_error" as const };
  };
  const stop = watchWalk(status, WALK, time.clock, (w) => seen.push(w), net.online);
  await flush();
  const tick = async (ms = POLL_MS) => {
    time.advance(ms);
    await flush();
  };
  return { time, net, asked, seen, stop, tick };
};

describe("watchWalk", () => {
  it("asks every 2 seconds, says each state, and stops asking at done", async () => {
    const w = await watching([at({ name: "queued" }), at({ name: "processing", step: "segment" }), at({ name: "done" })]);
    await w.tick();
    await w.tick();
    expect(w.asked).toEqual([1_000_000, 1_002_000, 1_004_000]);
    expect(w.seen).toEqual([
      { kind: "checking", state: { name: "queued" } },
      { kind: "checking", state: { name: "processing", step: "segment" } },
      { kind: "done" },
    ]);
    await w.tick(60_000);
    expect(w.asked).toHaveLength(3);
    expect(w.time.pending()).toBe(0);
  });

  it("says a failed walk's own code and message and stops at once", async () => {
    const w = await watching([at({ name: "failed", step: "score" }, "Something went wrong while checking this walk.")]);
    expect(w.seen).toEqual([{ kind: "failed", code: "pipeline_failed", message: "Something went wrong while checking this walk." }]);
    await w.tick(60_000);
    expect(w.asked).toHaveLength(1);
  });

  it("keeps asking after an answer off the contract, which counts as server_error", async () => {
    const w = await watching([{ code: "server_error" }, at({ name: "done" })]);
    expect(w.seen).toEqual([]);
    await w.tick();
    expect(w.asked).toHaveLength(2);
    expect(w.seen).toEqual([{ kind: "done" }]);
  });

  it("keeps asking after rate_limited", async () => {
    const w = await watching([{ code: "rate_limited" }, at({ name: "done" })]);
    expect(w.seen).toEqual([]);
    await w.tick();
    expect(w.asked).toHaveLength(2);
    expect(w.seen).toEqual([{ kind: "done" }]);
  });

  it("asks again after 30 seconds when an ask fails while the phone says it has signal", async () => {
    const w = await watching([{ code: "offline" }, at({ name: "done" })], true);
    expect(w.seen).toEqual([{ kind: "waiting" }]);
    await w.tick(SIGNAL_RETRY_MS - 1);
    expect(w.asked).toHaveLength(1);
    await w.tick(1);
    expect(w.asked).toHaveLength(2);
    expect(w.seen.at(-1)).toEqual({ kind: "done" });
    expect(w.net.listening()).toBe(0);
    expect(w.time.pending()).toBe(0);
  });

  it("asks once when signal returns before the 30 second retry, and never twice", async () => {
    const w = await watching([{ code: "offline" }, at({ name: "done" })], true);
    w.net.fire();
    await flush();
    expect(w.asked).toHaveLength(2);
    expect(w.time.pending()).toBe(0);
    await w.tick(SIGNAL_RETRY_MS);
    expect(w.asked).toHaveLength(2);
  });

  it("stops as lost when the API does not know the walk", async () => {
    const w = await watching([{ code: "unknown_walk" }]);
    expect(w.seen).toEqual([{ kind: "lost" }]);
    await w.tick(60_000);
    expect(w.asked).toHaveLength(1);
  });

  it.each(["invalid_request", "not_found", "method_not_allowed", "body_too_large", "walk_limit_reached"] as const)(
    "holds after a %s answer and keeps asking quietly every 30 seconds until the API answers",
    async (code) => {
      const w = await watching([{ code }, { code }, at({ name: "processing", step: "segment" })]);
      expect(w.seen).toEqual([{ kind: "held", code }]);
      await w.tick(HELD_RETRY_MS - 1);
      expect(w.asked).toHaveLength(1);
      await w.tick(1);
      expect(w.asked).toHaveLength(2);
      expect(w.seen).toEqual([{ kind: "held", code }, { kind: "held", code }]);
      await w.tick(HELD_RETRY_MS);
      expect(w.asked).toHaveLength(3);
      expect(w.seen.at(-1)).toEqual({ kind: "checking", state: { name: "processing", step: "segment" } });
    },
  );

  it("asks nothing more once stopped while held", async () => {
    const w = await watching([{ code: "invalid_request" }]);
    w.stop();
    expect(w.time.pending()).toBe(0);
    await w.tick(HELD_RETRY_MS);
    expect(w.asked).toHaveLength(1);
  });

  it("waits for signal with no ask meanwhile, then asks again as soon as signal returns", async () => {
    const w = await watching([{ code: "offline" }, at({ name: "processing", step: "explain" })]);
    expect(w.seen).toEqual([{ kind: "waiting" }]);
    await w.tick(60_000);
    expect(w.asked).toHaveLength(1);
    expect(w.net.listening()).toBe(1);
    w.net.fire();
    await flush();
    expect(w.asked).toHaveLength(2);
    expect(w.seen.at(-1)).toEqual({ kind: "checking", state: { name: "processing", step: "explain" } });
    expect(w.net.listening()).toBe(0);
  });

  it("asks nothing more once stopped, even with an answer still on its way or signal returning", async () => {
    const w = await watching([at({ name: "queued" })]);
    w.stop();
    await w.tick(60_000);
    expect(w.asked).toHaveLength(1);
    const offline = await watching([{ code: "offline" }]);
    offline.stop();
    expect(offline.net.listening()).toBe(0);
    offline.net.fire();
    await flush();
    expect(offline.asked).toHaveLength(1);
    const blip = await watching([{ code: "offline" }], true);
    blip.stop();
    expect(blip.time.pending()).toBe(0);
    await blip.tick(SIGNAL_RETRY_MS);
    expect(blip.asked).toHaveLength(1);
  });

  it("says nothing for an answer that arrives after it was stopped", async () => {
    const time = fakeClock();
    let answer: (a: Answer<WalkStatusResponse>) => void = () => undefined;
    const seen: Watched[] = [];
    const stop = watchWalk(() => new Promise((resolve) => (answer = resolve)), WALK, time.clock, (w) => seen.push(w), fakeOnline().online);
    stop();
    answer(at({ name: "done" }));
    await flush();
    expect(seen).toEqual([]);
    expect(time.pending()).toBe(0);
  });
});

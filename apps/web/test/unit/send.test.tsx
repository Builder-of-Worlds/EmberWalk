import type { FaultReportRequest, WalkState, WalkStatusResponse } from "@emberwalk/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Answer, Failure } from "../../src/api.ts";
import { App } from "../../src/App.tsx";
import { copy, unbacked } from "../../src/copy.ts";
import { DepsContext } from "../../src/deps.ts";
import type { Deps } from "../../src/deps.ts";
import { resultsFor, ROUTES, sendFor } from "../../src/router.ts";
import { Send } from "../../src/screens/Send.tsx";
import type { Sender } from "../../src/sender.ts";
import type { Progress, SendResult } from "../../src/uploader.ts";
import { HELD_RETRY_MS, POLL_MS, SIGNAL_RETRY_MS } from "../../src/watch.ts";
import type { WalkStatus } from "../../src/watch.ts";
import { fakeClock, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { SEND_AFTER, SEND_REWRITES, SETTLED_LEAVES, shownLines } from "./settled.ts";

const withTake = async (deps: Deps, endedBy: "stopped" | "time_limit" = "stopped", durationMs: number | null = 1000) => {
  const takes = await deps.takes();
  const take = await takes.create("video/mp4", 1);
  await takes.append(take.id, new Blob(["0123456789"]));
  if (durationMs !== null) await takes.finish(take.id, durationMs, endedBy);
  return deps;
};

const goOnline = () => settle(() => window.dispatchEvent(new Event("online")));

const waitingFor = async (durationMs: number | null, code: SendResult["code"] = "offline") => {
  const sender = controlled();
  const view = await show(await withTake(testDeps({ send: sender.send }), "stopped", durationMs));
  await settle(() => button(view.host)?.click());
  await settle(() => sender.finish({ code }));
  return { sender, view };
};

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  if (!check()) throw new Error("condition never became true");
};

const show = async (deps: Deps) => {
  const view = await render(
    <DepsContext.Provider value={deps}>
      <Send />
    </DepsContext.Provider>,
  );
  await until(() => view.text().includes(copy.send.saved));
  return view;
};

const button = (host: HTMLElement) => [...host.querySelectorAll("button")].find((b) => b.textContent === copy.leaves.send);

const heading = (host: HTMLElement) => host.querySelector("h1")?.textContent;

const controlled = () => {
  let report: (progress: Progress) => void = () => undefined;
  let finish: (result: SendResult) => void = () => undefined;
  const calls: string[] = [];
  const send: Sender = (take, onProgress) => {
    calls.push(take.id);
    report = onProgress;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  return { send, calls, report: (p: Progress) => report(p), finish: (r: SendResult) => finish(r) };
};

const refusedWith = async (code: SendResult["code"] & string) => {
  const sender = controlled();
  const view = await show(await withTake(testDeps({ send: sender.send })));
  await settle(() => button(view.host)?.click());
  await settle(() => sender.finish({ code }));
  return view.host.querySelector("[role=alert]")?.textContent;
};

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = "";
  document.body.innerHTML = "";
});

describe("What Leaves Your Phone", () => {
  it("shows only settled lines, with Send My Walk, Not Now and the Not Now line", async () => {
    const view = await show(await withTake(testDeps()));
    expect(heading(view.host)).toBe(copy.leaves.title);
    const lines = shownLines(view.host).filter((line) => line !== copy.send.saved);
    expect(lines.filter((line) => !SETTLED_LEAVES.includes(line))).toEqual([]);
    for (const line of [copy.leaves.sent, copy.leaves.never, copy.leaves.meta, copy.leaves.notNow, copy.leaves.later])
      expect(lines).toContain(line);
    expect(button(view.host)).toBeDefined();
    expect(view.host.querySelector(`a[href="${ROUTES.home}"]`)?.textContent).toBe(copy.leaves.notNow);
  });

  it("keeps the Location line off screen while nothing on the server backs it", async () => {
    const view = await show(await withTake(testDeps()));
    for (const line of Object.values(unbacked.leaves)) {
      expect(SETTLED_LEAVES).toContain(line);
      expect(view.text()).not.toContain(line);
    }
  });

  it("never says what is kept, or that the original video is deleted", async () => {
    const view = await show(await withTake(testDeps()));
    expect(view.text()).not.toMatch(/Kept|original video/);
    expect(Object.keys(unbacked.leaves)).toEqual(["location"]);
  });

  it("still says why a walk stopped early", async () => {
    const view = await show(await withTake(testDeps(), "time_limit"));
    expect(view.text()).toContain(copy.send.limitReached);
  });
});

describe("Send Your Walk", () => {
  it("shows progress while sending, then says the walk was sent", async () => {
    const sender = controlled();
    const view = await show(await withTake(testDeps({ send: sender.send })));
    await settle(() => button(view.host)?.click());
    expect(sender.calls).toHaveLength(1);
    expect(heading(view.host)).toBe(copy.send.title);
    expect(view.text()).toContain(copy.send.sending(0, 10));
    expect(view.text()).not.toContain(copy.leaves.sent);
    await settle(() => sender.report({ sentBytes: 5, totalBytes: 10 }));
    expect(view.text()).toContain("50% sent.");
    expect(view.host.querySelector("progress")?.getAttribute("value")).toBe("5");
    expect(button(view.host)).toBeUndefined();
    await settle(() => sender.finish({ walkId: "w" }));
    expect(view.host.querySelector("[role=status]")?.textContent).toBe(copy.send.sent);
    expect(button(view.host)).toBeUndefined();
  });

  it("explains a refusal in plain words and lets the walk be sent again, or later", async () => {
    const sender = controlled();
    const view = await show(await withTake(testDeps({ send: sender.send })));
    await settle(() => button(view.host)?.click());
    await settle(() => sender.finish({ code: "offline" }));
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe("Waiting for Signal.");
    expect(view.text()).toContain(copy.send.saved);
    expect(view.text()).toContain(copy.leaves.later);
    await settle(() => button(view.host)?.click());
    expect(sender.calls).toHaveLength(2);
    await settle(() => sender.finish({ code: "upload_expired" }));
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe(copy.send.refused.upload_expired);
  });

  describe("when signal is lost", () => {
    it("says it is waiting with the saved minutes, then sends by itself when signal returns", async () => {
      const { sender, view } = await waitingFor(130_000);
      expect(view.host.querySelector("[role=alert]")?.textContent).toBe(copy.send.refused.offline);
      expect(view.text()).toContain("3 minutes saved on this phone.");
      expect(sender.calls).toHaveLength(1);
      await goOnline();
      expect(sender.calls).toHaveLength(2);
      expect(view.host.querySelector("progress")).not.toBeNull();
      await settle(() => sender.finish({ walkId: "w" }));
      expect(view.host.querySelector("[role=status]")?.textContent).toBe(copy.send.sent);
      await goOnline();
      expect(sender.calls).toHaveLength(2);
    });

    it("still sends with a tap on the button", async () => {
      const { sender, view } = await waitingFor(130_000);
      await settle(() => button(view.host)?.click());
      expect(sender.calls).toHaveLength(2);
    });

    it("shows no count when the length is unknown, and says one minute for a short walk", async () => {
      const unknown = await waitingFor(null);
      expect(unknown.view.text()).toContain(copy.send.refused.offline);
      expect(unknown.view.text()).not.toMatch(/\d+ minutes? saved/);
      const short = await waitingFor(30_000);
      expect(short.view.text()).toContain("1 minute saved on this phone.");
      expect(short.view.text()).not.toContain("1 minutes");
    });

    it("starts nothing when signal returns after a refusal that signal cannot fix", async () => {
      const { sender } = await waitingFor(130_000, "too_large");
      await goOnline();
      expect(sender.calls).toHaveLength(1);
    });

    it("shows the saved minutes only while waiting for signal", async () => {
      const { view } = await waitingFor(130_000, "upload_expired");
      expect(view.host.querySelector("[role=alert]")?.textContent).toBe(copy.send.refused.upload_expired);
      expect(view.text()).not.toMatch(/\d+ minutes? saved/);
    });

    it("starts one send when signal returns twice before the screen has changed", async () => {
      const { sender } = await waitingFor(130_000);
      await settle(() => {
        window.dispatchEvent(new Event("online"));
        window.dispatchEvent(new Event("online"));
      });
      expect(sender.calls).toHaveLength(2);
    });

    it("starts no second send while one is running, and none after the screen is gone", async () => {
      const first = await waitingFor(130_000);
      await goOnline();
      await goOnline();
      expect(first.sender.calls).toHaveLength(2);

      const second = await waitingFor(130_000);
      await second.view.unmount();
      await goOnline();
      expect(second.sender.calls).toHaveLength(1);
    });
  });

  describe("when the phone has signal but the walk did not go through", () => {
    const stuck = async (code: SendResult["code"] = "offline") => {
      const time = fakeClock();
      const sender = controlled();
      const view = await show(await withTake(testDeps({ send: sender.send, clock: time.clock }), "stopped", 130_000));
      await settle(() => button(view.host)?.click());
      await settle(() => sender.finish({ code }));
      return { time, sender, view };
    };

    it("tries again by itself until the server answers, then says the walk was sent", async () => {
      const { time, sender, view } = await stuck();
      await settle(() => time.advance(SIGNAL_RETRY_MS - 1));
      expect(sender.calls).toHaveLength(1);
      await settle(() => time.advance(1));
      expect(sender.calls).toHaveLength(2);
      await settle(() => sender.finish({ code: "offline" }));
      expect(view.host.querySelector("[role=alert]")?.textContent).toBe(copy.send.refused.offline);
      await settle(() => time.advance(SIGNAL_RETRY_MS));
      expect(sender.calls).toHaveLength(3);
      await settle(() => sender.finish({ walkId: "w" }));
      expect(view.host.querySelector("[role=status]")?.textContent).toBe(copy.send.sent);
      await settle(() => time.advance(SIGNAL_RETRY_MS));
      expect(sender.calls).toHaveLength(3);
      expect(time.pending()).toBe(0);
    });

    it("leaves the clock alone while the phone reports no signal, and sends when signal returns", async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      const { time, sender } = await stuck();
      await settle(() => time.advance(SIGNAL_RETRY_MS * 3));
      expect(sender.calls).toHaveLength(1);
      await goOnline();
      expect(sender.calls).toHaveLength(2);
    });

    it("starts one send when a tap and the timer both come, and tries nothing after the screen is gone", async () => {
      const tapped = await stuck();
      await settle(() => button(tapped.view.host)?.click());
      await settle(() => tapped.time.advance(SIGNAL_RETRY_MS));
      expect(tapped.sender.calls).toHaveLength(2);

      const gone = await stuck();
      await gone.view.unmount();
      await settle(() => gone.time.advance(SIGNAL_RETRY_MS));
      expect(gone.sender.calls).toHaveLength(1);
      expect(gone.time.pending()).toBe(0);
    });

    it("tries nothing by itself after a refusal that waiting cannot fix", async () => {
      const { time, sender } = await stuck("too_large");
      await settle(() => time.advance(SIGNAL_RETRY_MS * 3));
      expect(sender.calls).toHaveLength(1);
      expect(time.pending()).toBe(0);
    });
  });

  it("explains a send that broke on the phone instead of showing progress for good", async () => {
    const view = await show(await withTake(testDeps({ send: () => Promise.reject(new Error("quota exceeded")) })));
    await settle(() => button(view.host)?.click());
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe(SEND_REWRITES.tryAgain);
    expect(view.host.querySelector("progress")).toBeNull();
    expect(button(view.host)).toBeDefined();
  });

  it("says the three rewritten lines Deacon settled in D-106", async () => {
    expect(await refusedWith("server_error")).toBe(SEND_REWRITES.tryAgain);
    expect(await refusedWith("invalid_request")).toBe(SEND_REWRITES.tryAgain);
    expect(await refusedWith("unknown_walk")).toBe(SEND_REWRITES.unknownWalk);
    expect(await refusedWith("walk_not_uploading")).toBe(SEND_REWRITES.walkNotUploading);
  });

  it("says there is no walk to send when the phone has none", async () => {
    const view = await render(
      <DepsContext.Provider value={testDeps()}>
        <Send takeId="gone" />
      </DepsContext.Provider>,
    );
    await until(() => view.text().includes(copy.send.none));
    expect(heading(view.host)).toBe(copy.send.title);
    expect(button(view.host)).toBeUndefined();
  });
});

describe("after the walk is sent", () => {
  const WALK = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b01";

  const sentWith = async (answers: Answer<WalkStatusResponse>[], overrides: Partial<Deps> = {}) => {
    const time = fakeClock();
    const asked: string[] = [];
    const walkStatus: WalkStatus = async (walkId) => {
      asked.push(walkId);
      return answers.shift() ?? { code: "server_error" };
    };
    const sender = controlled();
    const deps = await withTake(testDeps({ send: sender.send, clock: time.clock, walkStatus, ...overrides }));
    const view = await show(deps);
    await settle(() => button(view.host)?.click());
    await settle(() => sender.finish({ walkId: WALK }));
    const tick = () => settle(() => time.advance(POLL_MS));
    const kept = async () => (await (await deps.takes()).all()).length;
    return { view, asked, time, tick, kept };
  };

  const state = (s: WalkState, message: string | null = null): Answer<WalkStatusResponse> => ({
    value: { walkId: WALK, state: s, failure: message === null ? null : { code: "pipeline_failed", message } },
  });

  it("says the walk is still being checked with a plain step line, then opens its results at done", async () => {
    const { view, asked, tick } = await sentWith([state({ name: "queued" }), state({ name: "processing", step: "segment" }), state({ name: "processing", step: "explain" }), state({ name: "done" })]);
    expect(view.host.querySelector("[role=status]")?.textContent).toBe(copy.send.sent);
    expect(view.text()).toContain("This walk is still being checked.");
    expect(view.text()).toContain("Getting your walk ready to check.");
    await tick();
    expect(view.text()).toContain("Looking for what needs clearing.");
    await tick();
    expect(view.text()).toContain("Writing down what to do about each thing found.");
    expect(window.location.hash).not.toBe(resultsFor(WALK));
    await tick();
    expect(window.location.hash).toBe(resultsFor(WALK));
    expect(asked).toEqual([WALK, WALK, WALK, WALK]);
  });

  it("watches a walk of one side by its own id, then opens the results of the walk it is part of", async () => {
    const PARENT = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
    const time = fakeClock();
    const asked: string[] = [];
    const answers = [state({ name: "processing", step: "segment" }), state({ name: "done" })];
    const walkStatus: WalkStatus = async (walkId) => {
      asked.push(walkId);
      return answers.shift() ?? { code: "server_error" };
    };
    const sender = controlled();
    const deps = testDeps({ send: sender.send, clock: time.clock, walkStatus });
    const takes = await deps.takes();
    const take = await takes.create("video/mp4", 1, { jurisdiction: "ca", sound: true, partOf: { walkId: PARENT, side: "back" } });
    await takes.append(take.id, new Blob(["0123456789"]));
    await takes.finish(take.id, 1000, "stopped");
    const view = await show(deps);
    await settle(() => button(view.host)?.click());
    await settle(() => sender.finish({ walkId: WALK }));
    expect(window.location.hash).not.toBe(resultsFor(PARENT));
    await settle(() => time.advance(POLL_MS));
    expect(window.location.hash).toBe(resultsFor(PARENT));
    expect(asked).toEqual([WALK, WALK]);
    await view.unmount();
  });

  it("shows a failed walk's own message with Record a Walk, and opens no results", async () => {
    const { view } = await sentWith([state({ name: "failed", step: "score" }, "Something went wrong while checking this walk.")]);
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe("Something went wrong while checking this walk.");
    expect(view.host.querySelector(`a[href="${ROUTES.record}"]`)?.textContent).toBe(copy.send.recordWalk);
    expect(view.text()).not.toContain(copy.send.refused.walk_not_done);
    expect(window.location.hash).not.toBe(resultsFor(WALK));
  });

  it("says a walk the API no longer finds in Deacon's words (D-165), with Record a Walk", async () => {
    const { view } = await sentWith([{ code: "unknown_walk" }]);
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe(SEND_AFTER.lost);
    expect(view.host.querySelector(`a[href="${ROUTES.record}"]`)?.textContent).toBe(copy.send.recordWalk);
  });

  it.each(["invalid_request", "not_found", "method_not_allowed", "body_too_large"] as const)(
    "never asks for a new walk after a %s answer: it keeps asking quietly and carries on when the API answers",
    async (code) => {
      const { view, asked, time } = await sentWith([{ code }, state({ name: "processing", step: "segment" })]);
      expect(view.host.querySelector("[role=status]")?.textContent).toBe(copy.send.sent);
      expect(view.host.querySelector(`a[href="${ROUTES.record}"]`)).toBeNull();
      expect(view.host.querySelector("[role=alert]")).toBeNull();
      expect(button(view.host)).toBeUndefined();
      expect(view.text()).not.toContain(copy.leaves.send);
      expect(view.text()).toContain(SEND_AFTER.held);
      await settle(() => time.advance(HELD_RETRY_MS));
      await until(() => asked.length === 2);
      await until(() => view.text().includes("Looking for what needs clearing."));
    },
  );

  describe("when a status ask is refused", () => {
    const BUILD_ID = "a1b2c3d4e5f6";
    const received: ReturnType<Deps["reportFault"]> = Promise.resolve({ value: { received: true } });

    const reporter = (answer: () => ReturnType<Deps["reportFault"]> = () => received) => {
      const reports: FaultReportRequest[] = [];
      const reportFault: Deps["reportFault"] = (report) => {
        reports.push(report);
        return answer();
      };
      return { reports, overrides: { reportFault, build: BUILD_ID } };
    };

    const heldTimes = async (n: number, code: Failure) => {
      const sent = reporter();
      const flow = await sentWith(Array.from({ length: n }, () => ({ code })), sent.overrides);
      for (let i = 1; i < n; i += 1) await settle(() => flow.time.advance(HELD_RETRY_MS));
      return { ...flow, reports: sent.reports };
    };

    it("sends one report with the walk id, the code and the build", async () => {
      const sent = reporter();
      await sentWith([{ code: "invalid_request" }], sent.overrides);
      await until(() => sent.reports.length === 1);
      expect(sent.reports).toEqual([{ walkId: WALK, code: "invalid_request", build: BUILD_ID }]);
    });

    it("sends one report for ten held answers with the same code", async () => {
      const { asked, reports, view } = await heldTimes(10, "invalid_request");
      expect(asked).toHaveLength(10);
      expect(reports).toHaveLength(1);
      await view.unmount();
    });

    it("sends one more when a different code holds the walk", async () => {
      const sent = reporter();
      const { time } = await sentWith([{ code: "invalid_request" }, { code: "invalid_request" }, { code: "not_found" }, { code: "not_found" }], sent.overrides);
      for (let i = 0; i < 3; i += 1) await settle(() => time.advance(HELD_RETRY_MS));
      expect(sent.reports.map((r) => r.code)).toEqual(["invalid_request", "not_found"]);
    });

    it.each(["unknown_walk", "server_error", "rate_limited", "offline"] as const)("never reports a %s answer, and never says it was reported", async (code) => {
      const sent = reporter();
      const { time, view } = await sentWith([{ code }, { code }, { code }], sent.overrides);
      for (let i = 0; i < 3; i += 1) await settle(() => time.advance(HELD_RETRY_MS));
      expect(sent.reports).toEqual([]);
      expect(view.text()).not.toContain(SEND_AFTER.reported);
    });

    it.each([
      ["offline", () => Promise.resolve({ code: "offline" as const })],
      ["refused", () => Promise.resolve({ code: "rate_limited" as const })],
      ["thrown", () => Promise.reject(new Error("no network"))],
    ])("leaves the screen as it was, and asks no second time, when the report is %s", async (_name, answer) => {
      const sent = reporter(answer);
      const { view, time, asked } = await sentWith([{ code: "invalid_request" }, { code: "invalid_request" }], sent.overrides);
      await until(() => sent.reports.length === 1);
      expect(view.host.querySelector("[role=status]")?.textContent).toBe(copy.send.sent);
      expect(view.text()).toContain(SEND_AFTER.held);
      expect(view.host.querySelector("[role=alert]")).toBeNull();
      await settle(() => time.advance(HELD_RETRY_MS));
      expect(asked).toHaveLength(2);
      expect(sent.reports).toHaveLength(1);
      expect(view.text()).toContain(SEND_AFTER.held);
      expect(view.text()).not.toContain(SEND_AFTER.reported);
    });

    it("shows the held line until the report is received, then the reported line in its place, word for word (D-182)", async () => {
      let answer: (value: Awaited<ReturnType<Deps["reportFault"]>>) => void = () => undefined;
      const sent = reporter(() => new Promise((resolve) => (answer = resolve)));
      const { view } = await sentWith([{ code: "invalid_request" }], sent.overrides);
      await until(() => sent.reports.length === 1);
      expect(view.text()).toContain(SEND_AFTER.held);
      expect(view.text()).not.toContain(SEND_AFTER.reported);
      await settle(() => answer({ value: { received: true } }));
      await until(() => view.text().includes(SEND_AFTER.reported));
      expect(copy.send.reported).toBe(SEND_AFTER.reported);
      expect(view.text()).not.toContain(SEND_AFTER.held);
      expect(view.host.querySelector("[role=status]")?.textContent).toBe(copy.send.sent);
      expect(view.host.querySelector("[role=alert]")).toBeNull();
      expect(view.host.querySelector(`a[href="${ROUTES.record}"]`)).toBeNull();
      expect(shownLines(view.host)).toEqual([copy.send.title, copy.send.sent, SEND_AFTER.reported]);
    });

    it("keeps the reported line while the walk stays held, and shows the walk's step once it moves on", async () => {
      const sent = reporter();
      const { view, time } = await sentWith([{ code: "invalid_request" }, { code: "invalid_request" }, state({ name: "processing", step: "segment" })], sent.overrides);
      await until(() => view.text().includes(SEND_AFTER.reported));
      await settle(() => time.advance(HELD_RETRY_MS));
      expect(view.text()).toContain(SEND_AFTER.reported);
      await settle(() => time.advance(HELD_RETRY_MS));
      await until(() => view.text().includes("Looking for what needs clearing."));
      expect(view.text()).not.toContain(SEND_AFTER.reported);
    });

    it("has no send line left waiting for approval", () => {
      expect(Object.keys(unbacked)).not.toContain("send");
    });
  });

  it("shows Record a Walk and no empty alert for a failed walk that carries no message", async () => {
    const { view } = await sentWith([state({ name: "failed", step: "score" })]);
    expect(view.host.querySelector("[role=alert]")).toBeNull();
    expect(view.host.querySelector(`a[href="${ROUTES.record}"]`)?.textContent).toBe(copy.send.recordWalk);
    expect(window.location.hash).not.toBe(resultsFor(WALK));
  });

  it("waits for signal while checking, then carries on when signal returns", async () => {
    const { view, asked, tick } = await sentWith([{ code: "offline" }, state({ name: "processing", step: "segment" })]);
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe("Waiting for Signal.");
    await tick();
    expect(asked).toHaveLength(1);
    await goOnline();
    await until(() => asked.length === 2);
    await until(() => view.text().includes("Looking for what needs clearing."));
    expect(view.host.querySelector("[role=alert]")).toBeNull();
  });

  it("keeps the walk on the phone until the server answers for it, then lets it go", async () => {
    for (const answer of [state({ name: "queued" }), state({ name: "done" }), state({ name: "failed", step: "score" }), { code: "unknown_walk" as const }]) {
      const { view, kept } = await sentWith([answer]);
      await until(() => view.host.querySelector("h1") !== null);
      expect(await kept()).toBe(0);
      await view.unmount();
    }
  });

  it("lets the walk go once, not again at every answer after", async () => {
    const time = fakeClock();
    const answers = [state({ name: "queued" }), state({ name: "processing", step: "segment" }), state({ name: "processing", step: "explain" })];
    const sender = controlled();
    const deps = await withTake(testDeps({ send: sender.send, clock: time.clock, walkStatus: async () => answers.shift() ?? state({ name: "queued" }) }));
    const remove = vi.spyOn(await deps.takes(), "remove");
    const view = await show(deps);
    await settle(() => button(view.host)?.click());
    await settle(() => sender.finish({ walkId: WALK }));
    for (let i = 0; i < 3; i += 1) await settle(() => time.advance(POLL_MS));
    expect(remove).toHaveBeenCalledTimes(1);
    await view.unmount();
  });

  it.each(["invalid_request", "offline"] as const)("keeps the walk on the phone while a %s answer holds it", async (code) => {
    const { view, kept } = await sentWith([{ code }]);
    expect(await kept()).toBe(1);
    await view.unmount();
  });

  it("asks nothing more once the screen is gone", async () => {
    const { view, asked, time, tick } = await sentWith([state({ name: "queued" })]);
    await view.unmount();
    await tick();
    expect(asked).toHaveLength(1);
    expect(time.pending()).toBe(0);
  });
});

describe("Not Now", () => {
  it("keeps the walk on the phone, and Your Walks sends it later", async () => {
    const sender = controlled();
    const deps = await withTake(testDeps({ send: sender.send }));
    const take = await (await deps.takes()).latest();
    window.location.hash = sendFor(take?.id ?? "");
    const view = await render(<App deps={deps} />);
    await until(() => view.text().includes(copy.leaves.title));

    const notNow = view.host.querySelector<HTMLAnchorElement>(`a[href="${ROUTES.home}"]`);
    expect(notNow?.textContent).toBe(copy.leaves.notNow);
    await settle(() => {
      window.location.hash = notNow?.getAttribute("href") ?? "";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(sender.calls).toEqual([]);
    await until(() => view.text().includes(copy.home.walks));

    const later = view.host.querySelector<HTMLAnchorElement>(".walks a");
    expect(later?.getAttribute("href")).toBe(sendFor(take?.id ?? ""));
    await settle(() => {
      window.location.hash = later?.getAttribute("href") ?? "";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await until(() => button(view.host) !== undefined);
    await settle(() => button(view.host)?.click());
    expect(sender.calls).toEqual([take?.id]);
    await view.unmount();
  });
});

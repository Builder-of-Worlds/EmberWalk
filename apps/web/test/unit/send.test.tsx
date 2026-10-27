import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App.tsx";
import { copy, unbacked } from "../../src/copy.ts";
import { DepsContext } from "../../src/deps.ts";
import type { Deps } from "../../src/deps.ts";
import { ROUTES, sendFor } from "../../src/router.ts";
import { Send, SIGNAL_RETRY_MS } from "../../src/screens/Send.tsx";
import type { Sender } from "../../src/sender.ts";
import type { Progress, SendResult } from "../../src/uploader.ts";
import { fakeClock, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { SEND_REWRITES, SETTLED_LEAVES, shownLines } from "./settled.ts";

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

  it("keeps the Kept and Location lines off screen while nothing on the server backs them", async () => {
    const view = await show(await withTake(testDeps()));
    for (const line of Object.values(unbacked.leaves)) {
      expect(SETTLED_LEAVES).toContain(line);
      expect(view.text()).not.toContain(line);
    }
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
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe("Waiting for signal.");
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

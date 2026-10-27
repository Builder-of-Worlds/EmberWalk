import { afterEach, describe, expect, it } from "vitest";
import { clockText, copy } from "../../src/copy.ts";
import { DepsContext } from "../../src/deps.ts";
import type { Deps } from "../../src/deps.ts";
import { ROUTES } from "../../src/router.ts";
import { Record } from "../../src/screens/Record.tsx";
import { Send } from "../../src/screens/Send.tsx";
import { deniedError, fakeClock, fakeMotion, FakeRecorder, grantedMedia, testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";

const show = (deps: Deps, screen: "record" | "send" = "record") =>
  render(<DepsContext.Provider value={deps}>{screen === "record" ? <Record /> : <Send />}</DepsContext.Provider>);

const click = async (host: HTMLElement, label: string) => {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === label);
  if (button === undefined) throw new Error(`no button "${label}" in: ${host.textContent}`);
  await settle(() => button.click());
};

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  if (!check()) throw new Error("condition never became true");
};

afterEach(() => {
  window.location.hash = "";
  FakeRecorder.supported = new Set(["video/mp4"]);
});

describe("clockText", () => {
  it("shows minutes and seconds, rounding part seconds up and never below zero", () => {
    expect(clockText(360_000)).toBe("6:00");
    expect(clockText(61_001)).toBe("1:02");
    expect(clockText(9_000)).toBe("0:09");
    expect(clockText(-5)).toBe("0:00");
  });

  it("states the walk limit from the shared limits", () => {
    expect(copy.record.limit).toBe("A walk can be up to 6 minutes long.");
    expect(copy.send.limitReached).toBe("Recording stopped at the 6 minute limit.");
  });
});

describe("Record screen", () => {
  it("records a walk, shows the time left, saves it and moves on to sending", async () => {
    const time = fakeClock();
    const deps = testDeps({ clock: time.clock, maxWalkMs: 360_000 });
    const view = await show(deps);
    await until(() => view.text().includes(copy.record.start));
    expect(view.text()).toContain(copy.record.ready);
    await click(view.host, copy.record.start);
    await until(() => view.host.querySelector("video") !== null);
    expect(view.host.querySelector("[role=timer]")?.textContent).toBe("6:00 left");
    await settle(() => {
      FakeRecorder.last?.emit("walk video");
      time.advance(3000);
    });
    await click(view.host, copy.record.stop);
    await until(() => window.location.hash === ROUTES.send);
    const take = await (await deps.takes()).latest();
    expect(take).toMatchObject({ endedBy: "stopped", durationMs: 3000, bytes: 10, mimeType: "video/mp4" });
    await view.unmount();
  });

  it("explains a refused camera and offers to try again", async () => {
    const media = grantedMedia();
    media.getUserMedia.mockRejectedValueOnce(deniedError());
    const view = await show(testDeps({ media }));
    await until(() => view.text().includes(copy.record.start));
    await click(view.host, copy.record.start);
    await until(() => view.host.querySelector("[role=alert]") !== null);
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe(copy.record.denied);
    await click(view.host, copy.record.tryAgain);
    await until(() => view.host.querySelector("video") !== null);
    await view.unmount();
  });

  it("explains a browser that cannot record MP4", async () => {
    FakeRecorder.supported = new Set();
    const view = await show(testDeps());
    await until(() => view.text().includes(copy.record.start));
    await click(view.host, copy.record.start);
    await until(() => view.host.querySelector("[role=alert]") !== null);
    expect(view.host.querySelector("[role=alert]")?.textContent).toBe(copy.record.unsupported);
    await view.unmount();
  });

  it("offers a saved walk before recording over it, and deletes it only when asked", async () => {
    const deps = testDeps();
    const takes = await deps.takes();
    const old = await takes.create("video/mp4", 1);
    const view = await show(deps);
    await until(() => view.text().includes(copy.record.saved));
    expect(view.host.querySelector(`a[href="${ROUTES.send}"]`)?.textContent).toBe(copy.record.sendSaved);
    expect(await takes.latest()).toMatchObject({ id: old.id });
    await click(view.host, copy.record.recordAgain);
    await until(() => view.text().includes(copy.record.start));
    expect(await takes.latest()).toBeNull();
    await view.unmount();
  });
});

const pressed = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)?.getAttribute("aria-pressed");

const enabled = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll("button")].find((b) => b.textContent === label)?.disabled === false;

const startWalk = async (deps: Deps) => {
  const view = await show(deps);
  await until(() => view.text().includes(copy.record.start));
  return view;
};

describe("Get ready and recording", () => {
  it("Sound Off before the walk asks for no microphone and saves a take with no sound track", async () => {
    const media = grantedMedia();
    const deps = testDeps({ media });
    const view = await startWalk(deps);
    expect(pressed(view.host, copy.record.soundOff)).toBe("false");
    await click(view.host, copy.record.soundOff);
    expect(pressed(view.host, copy.record.soundOff)).toBe("true");
    await click(view.host, copy.record.start);
    await until(() => view.host.querySelector("video") !== null);
    expect(media.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    const stream = FakeRecorder.last?.stream as MediaStream;
    expect(stream.getAudioTracks()).toEqual([]);
    expect(pressed(view.host, copy.record.soundOff)).toBe("true");
    expect(enabled(view.host, copy.record.soundOff)).toBe(false);
    await click(view.host, copy.record.stop);
    await until(() => window.location.hash === ROUTES.send);
    expect(await (await deps.takes()).latest()).toMatchObject({ sound: false });
    await view.unmount();
  });

  it("Sound Off pressed twice before the walk keeps sound on", async () => {
    const media = grantedMedia();
    const view = await startWalk(testDeps({ media }));
    await click(view.host, copy.record.soundOff);
    await click(view.host, copy.record.soundOff);
    await click(view.host, copy.record.start);
    await until(() => view.host.querySelector("video") !== null);
    expect(media.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: true }));
    await view.unmount();
  });

  it("Sound Off during the walk silences the microphone and marks the take", async () => {
    const time = fakeClock();
    const deps = testDeps({ clock: time.clock });
    const view = await startWalk(deps);
    await click(view.host, copy.record.start);
    await until(() => view.host.querySelector("video") !== null);
    const stream = FakeRecorder.last?.stream as MediaStream;
    await settle(() => time.advance(4000));
    await click(view.host, copy.record.soundOff);
    expect(stream.getAudioTracks().map((t) => t.enabled)).toEqual([false]);
    expect(enabled(view.host, copy.record.soundOff)).toBe(false);
    await click(view.host, copy.record.stop);
    await until(() => window.location.hash === ROUTES.send);
    expect(await (await deps.takes()).latest()).toMatchObject({ sound: true, marks: { soundOffAtMs: 4000 } });
    await view.unmount();
  });

  it("Pause holds the recording and Property Line marks the video, but not while paused", async () => {
    const time = fakeClock();
    const deps = testDeps({ clock: time.clock });
    const view = await startWalk(deps);
    await click(view.host, copy.record.start);
    await until(() => view.host.querySelector("video") !== null);
    await settle(() => time.advance(1000));
    await click(view.host, copy.record.propertyLine);
    await click(view.host, copy.record.pause);
    expect(FakeRecorder.last?.state).toBe("paused");
    expect(pressed(view.host, copy.record.pause)).toBe("true");
    expect(enabled(view.host, copy.record.propertyLine)).toBe(false);
    await settle(() => time.advance(5000));
    await click(view.host, copy.record.pause);
    expect(FakeRecorder.last?.state).toBe("recording");
    expect(pressed(view.host, copy.record.pause)).toBe("false");
    await settle(() => time.advance(2000));
    await click(view.host, copy.record.stop);
    await until(() => window.location.hash === ROUTES.send);
    const take = await (await deps.takes()).latest();
    expect(take?.marks.pauses).toEqual([{ atMs: 1000, forMs: 5000 }]);
    expect(take?.marks.propertyLines).toEqual([1000]);
    expect(take?.durationMs).toBe(3000);
    await view.unmount();
  });

  it("asks for motion only when recording starts, and lights a corner of the outline for each quarter turn", async () => {
    const motion = fakeMotion();
    const deps = testDeps({ motion: motion.env });
    const view = await startWalk(deps);
    expect(motion.requestPermission).not.toHaveBeenCalled();
    await click(view.host, copy.record.start);
    await until(() => view.host.querySelector("svg.outline") !== null);
    expect(motion.requestPermission).toHaveBeenCalledOnce();
    const corners = () => view.host.querySelector("svg.outline")?.getAttribute("data-corners");
    expect(corners()).toBe("0");
    await settle(() => {
      for (const heading of [0, 45, 95, 150, 185]) motion.turn(heading);
    });
    expect(corners()).toBe("2");
    expect(view.host.querySelectorAll("svg.outline circle.done")).toHaveLength(2);
    expect(view.host.querySelector("svg.outline")?.getAttribute("aria-hidden")).toBe("true");
    await click(view.host, copy.record.stop);
    await until(() => window.location.hash === ROUTES.send);
    expect((await (await deps.takes()).latest())?.marks.motion.length).toBeGreaterThan(0);
    await view.unmount();
  });

  it("records without the outline when motion is refused", async () => {
    const motion = fakeMotion();
    motion.requestPermission.mockResolvedValueOnce("denied");
    const view = await startWalk(testDeps({ motion: motion.env }));
    await click(view.host, copy.record.start);
    await until(() => view.host.querySelector("video") !== null);
    expect(view.host.querySelector("svg.outline")).toBeNull();
    expect(motion.listening()).toBe(0);
    await view.unmount();
  });

  it("stores the confirmed rules with the walk", async () => {
    const deps = testDeps();
    deps.prefs.setJurisdiction("ca_sra");
    const view = await startWalk(deps);
    await click(view.host, copy.record.start);
    await until(() => view.host.querySelector("video") !== null);
    expect(await (await deps.takes()).latest()).toMatchObject({ jurisdiction: "ca_sra" });
    await view.unmount();
  });

  it("stores the camera and its picture size with the walk", async () => {
    const deps = testDeps();
    const view = await startWalk(deps);
    await click(view.host, copy.record.start);
    await until(() => view.host.querySelector("video") !== null);
    expect((await (await deps.takes()).latest())?.device).toEqual({ camera: "Back Camera", width: 1280, height: 720 });
    await view.unmount();
  });
});

describe("Send screen", () => {
  it("says the walk is saved, and why recording stopped when it was not by hand", async () => {
    const deps = testDeps();
    const takes = await deps.takes();
    const take = await takes.create("video/mp4", 1);
    await takes.finish(take.id, 360_000, "time_limit");
    const view = await show(deps, "send");
    await until(() => view.text().includes(copy.send.saved));
    expect(view.text()).toContain(copy.send.limitReached);
    expect(view.text()).not.toContain(copy.send.cameraStopped);
    await takes.finish(take.id, 1000, "failed");
    const again = await show(deps, "send");
    await until(() => again.text().includes(copy.send.cameraStopped));
    await view.unmount();
    await again.unmount();
  });

  it("says plainly when there is nothing to send", async () => {
    const view = await show(testDeps(), "send");
    await until(() => view.text().includes(copy.send.none));
    expect(view.host.querySelector(`a[href="${ROUTES.record}"]`)?.textContent).toBe(copy.send.recordWalk);
    await view.unmount();
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { type Box, damp, dampBox, secondsAt, trackRate } from "../../src/beat/box-route.ts";
import { BEAT_WORDS, bootBeat, type Host, REDUCED_MOTION, recordedProbe, shrunk } from "../../src/beat/box-route-page.ts";

const PAGE = `<div class="frame"><video></video><div class="marker"></div></div><p class="line first"></p><p class="line second"></p>`;
const START = 1000;
const probe = recordedProbe();
const NOTHING_AT = 1.125;
const FOUND_AT = 5.75;

const stage = (reduced = false, page = PAGE) => {
  document.body.innerHTML = page;
  const video = document.querySelector("video")!;
  const calls = { play: 0, pause: 0 };
  let paused = true;
  let currentTime = 0;
  Object.defineProperty(video, "paused", { get: () => paused, configurable: true });
  Object.defineProperty(video, "currentTime", { get: () => currentTime, set: (v: number) => void (currentTime = v), configurable: true });
  video.play = async () => {
    calls.play++;
    paused = false;
  };
  video.pause = () => {
    calls.pause++;
    paused = true;
  };
  const frames: ((now: number) => void)[] = [];
  const queries: string[] = [];
  const host: Host = {
    document,
    matchMedia: (query) => {
      queries.push(query);
      return { matches: reduced };
    },
    requestAnimationFrame: (callback) => frames.push(callback),
    performance: { now: () => START },
  };
  bootBeat(host, "walk.mp4", probe);
  const marker = document.querySelector<HTMLElement>(".marker")!;
  const [first, second] = [...document.querySelectorAll<HTMLElement>(".line")] as [HTMLElement, HTMLElement];
  return {
    video,
    calls,
    frames,
    queries,
    first,
    second,
    step: (seconds: number) => frames.splice(0).forEach((f) => f(START + seconds * 1000)),
    fire: (type: string) => video.dispatchEvent(new Event(type)),
    markerBox: (): Box => {
      const [l, t, w, h] = [marker.style.left, marker.style.top, marker.style.width, marker.style.height].map((v) => parseFloat(v) / 100) as [number, number, number, number];
      return [l, t, l + w, t + h];
    },
    opacity: () => Number(marker.style.opacity),
  };
};

const close = (a: Box, b: Box, digits = 9) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, digits));
const said = (line: HTMLElement) => ({ text: line.textContent, shown: line.classList.contains("shown") });

const begun = (reduced = false) => {
  const s = stage(reduced);
  s.fire("loadeddata");
  s.fire("seeked");
  return s;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the box route words", () => {
  it("are the approved lines, word for word", () => {
    expect(BEAT_WORDS.phrase).toBe("SAM 3.1 is asked for “dry brush”.");
    expect(BEAT_WORDS.nothing).toBe("Nothing found.");
    expect(BEAT_WORDS.point).toBe("Muse Spark draws one box on one frame.");
    expect(BEAT_WORDS.track).toBe("SAM 3.1 follows that box through the video.");
    expect(BEAT_WORDS.found(12, 16)).toBe("Found on 12 of 16 frames.");
  });
});

describe("the recorded box probe", () => {
  it("is the dry brush Muse Spark pointed at on frame 20 and SAM 3.1 tracked to frame 31", () => {
    expect(probe).toMatchObject({ frame: 20, lastFrame: 31, hits: 12, window: 16 });
    close(probe.spark, [264 / 1920, 444 / 1080, 884 / 1920, 719 / 1080]);
    expect(probe.tracked.size).toBe(17);
    expect(() => recordedProbe("no-such-hazard")).toThrow(/no-such-hazard/);
  });

  it("grows a box about its centre", () => {
    close(shrunk([0.2, 0.4, 0.6, 0.8], 0.5), [0.3, 0.5, 0.5, 0.7]);
  });
});

describe("the box route beat page", () => {
  it("loads the walk muted, seeks to the pointed frame, and starts only once the seek lands", () => {
    const s = stage();
    expect(s.queries).toEqual(["(prefers-reduced-motion: reduce)"]);
    expect(REDUCED_MOTION).toBe("(prefers-reduced-motion: reduce)");
    expect(s.video.src.endsWith("walk.mp4")).toBe(true);
    expect(s.video.muted).toBe(true);
    s.fire("loadeddata");
    expect(s.video.currentTime).toBe(secondsAt(20));
    expect(s.frames).toHaveLength(0);
    s.fire("seeked");
    expect(s.frames).toHaveLength(1);
  });

  it("asks for the phrase, then says nothing was found, with no box shown", () => {
    const s = begun();
    s.step(0);
    expect(said(s.first)).toEqual({ text: BEAT_WORDS.phrase, shown: true });
    expect(said(s.second)).toEqual({ text: BEAT_WORDS.nothing, shown: false });
    expect(s.opacity()).toBe(0);
    close(s.markerBox(), shrunk(probe.spark, 0.6));
    const words = s.first.firstChild;
    s.step(NOTHING_AT);
    expect(said(s.second).shown).toBe(false);
    s.step(NOTHING_AT + 0.001);
    expect(said(s.second).shown).toBe(true);
    expect(s.first.firstChild).toBe(words);
  });

  it("draws Muse Spark's box in, damped, and settles on it", () => {
    const s = begun();
    s.step(2.45);
    s.step(2.5);
    expect(said(s.first)).toEqual({ text: BEAT_WORDS.point, shown: true });
    expect(said(s.second)).toEqual({ text: "", shown: false });
    expect(s.opacity()).toBeCloseTo(damp(0, 1, 0.05, 2.5), 9);
    close(s.markerBox(), dampBox(shrunk(probe.spark, 0.6), probe.spark, 0.05, 2.5));
    const drawn = s.opacity();
    s.step(3.5);
    expect(s.opacity()).toBeCloseTo(damp(drawn, 1, 0.1, 2.5), 9);
    for (let at = 3.55; at < 4.5; at += 0.05) s.step(at);
    close(s.markerBox(), probe.spark, 2);
    expect(s.calls.play).toBe(0);
  });

  it("plays the tracked stretch once, follows SAM 3.1's box, and stops on the last tracked frame", () => {
    const s = begun();
    s.step(4.45);
    s.step(4.5);
    s.step(4.55);
    expect(s.calls.play).toBe(1);
    expect(s.video.playbackRate).toBe(trackRate(20, 31));
    expect(said(s.first)).toEqual({ text: BEAT_WORDS.track, shown: true });
    expect(said(s.second)).toEqual({ text: BEAT_WORDS.found(12, 16), shown: false });

    s.video.currentTime = 0;
    const before = s.markerBox();
    s.step(4.6);
    close(s.markerBox(), before, 6);

    s.video.currentTime = secondsAt(25);
    const from = s.markerBox();
    s.step(4.65);
    close(s.markerBox(), dampBox(from, probe.tracked.get(25)!, 0.05, 5), 6);

    s.step(FOUND_AT);
    expect(said(s.second).shown).toBe(false);
    s.step(FOUND_AT + 0.001);
    expect(said(s.second)).toEqual({ text: "Found on 12 of 16 frames.", shown: true });

    s.video.currentTime = secondsAt(31) - 0.01;
    s.step(6);
    expect(s.video.paused).toBe(false);
    expect(s.frames).toHaveLength(1);
    s.video.currentTime = secondsAt(31);
    s.step(6.05);
    expect(s.video.paused).toBe(true);
    expect(s.frames).toHaveLength(0);
  });

  it("ignores a second load or seek once running", () => {
    const s = begun();
    s.step(3);
    s.fire("seeked");
    expect(s.frames).toHaveLength(1);
    s.video.currentTime = 12;
    s.fire("loadeddata");
    expect(s.video.currentTime).toBe(12);
  });

  it("replays from the start on R or a click, and on no other key", () => {
    const s = begun();
    for (let at = 4.4; at < 5; at += 0.1) s.step(at);
    expect(s.calls.play).toBe(1);
    const pauses = s.calls.pause;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "x" }));
    expect(s.calls.pause).toBe(pauses);

    for (const replay of [() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "r" })), () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "R" })), () => document.body.click()]) {
      s.video.currentTime = 15;
      replay();
      expect(s.video.paused).toBe(true);
      expect(s.video.currentTime).toBe(secondsAt(20));
      s.fire("seeked");
      s.frames.splice(1);
      s.step(0);
      expect(said(s.first).text).toBe(BEAT_WORDS.phrase);
      expect(s.opacity()).toBe(0);
      close(s.markerBox(), shrunk(probe.spark, 0.6));
      const plays = s.calls.play;
      for (let at = 4.4; at < 5; at += 0.1) s.step(at);
      expect(s.calls.play).toBe(plays + 1);
    }
  });

  it("shows the finished beat as a still when motion is reduced", () => {
    const s = begun(true);
    expect(said(s.first)).toEqual({ text: BEAT_WORDS.track, shown: true });
    expect(said(s.second)).toEqual({ text: BEAT_WORDS.found(12, 16), shown: true });
    close(s.markerBox(), probe.tracked.get(20)!, 6);
    expect(s.opacity()).toBe(1);
    expect(s.frames).toHaveLength(0);
    expect(s.calls.play).toBe(0);
  });

  it("refuses a page that is missing a part", () => {
    expect(() => stage(false, `<video></video><p class="line first"></p><p class="line second"></p>`)).toThrow(/\.marker/);
  });
});

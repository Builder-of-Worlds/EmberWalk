import answers from "../../../../fixtures/meta/box-probe-test-yard-2-answers.json";
import rows from "../../../../fixtures/meta/box-probe-test-yard-2-rows.json";
import { type Box, boxAt, damp, dampBox, frameAt, phaseAt, pixelBox, samBoxes, secondsAt, trackRate } from "./box-route.ts";

const VIDEO = { width: 1920, height: 1080 };
export const NOTHING_AT = 1.125;
export const FOUND_AT = 5.75;
export const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

export const BEAT_WORDS = {
  phrase: "SAM 3.1 is asked for “dry brush”.",
  nothing: "Nothing found.",
  point: "Muse Spark draws one box on one frame.",
  track: "SAM 3.1 follows that box through the video.",
  found: (hits: number, frames: number) => `Found on ${hits} of ${frames} frames.`,
} as const;

type Answer = { output?: { type: string; content?: { text?: string }[] }[] };

const textOf = (answer: Answer | undefined): string =>
  (answer?.output ?? []).filter((o) => o.type === "message").flatMap((o) => (o.content ?? []).map((c) => c.text ?? "")).join("");

export type Probe = { spark: Box; tracked: Map<number, Box>; frame: number; lastFrame: number; hits: number; window: number };

export const recordedProbe = (hazard = "dry-brush-1"): Probe => {
  const row = rows[0]!.find((r) => r.hazard === hazard);
  if (row === undefined) throw new Error(`the box probe has no ${hazard}`);
  const tracked = samBoxes(textOf((answers as Record<string, Answer>)[`pass1-${row.samFingerprint}`]));
  return {
    spark: pixelBox(row.pixels, VIDEO.width, VIDEO.height),
    tracked,
    frame: row.frame,
    lastFrame: Math.max(...tracked.keys()),
    hits: row.hits,
    window: row.window,
  };
};

export type Host = {
  document: Document;
  matchMedia: (query: string) => { matches: boolean };
  requestAnimationFrame: (callback: (now: number) => void) => unknown;
  performance: { now: () => number };
};

export const shrunk = (box: Box, k: number): Box => {
  const cx = (box[0] + box[2]) / 2;
  const cy = (box[1] + box[3]) / 2;
  return [cx + (box[0] - cx) * k, cy + (box[1] - cy) * k, cx + (box[2] - cx) * k, cy + (box[3] - cy) * k];
};

export const bootBeat = (host: Host, src: string, probe: Probe = recordedProbe()) => {
  const el = <T extends HTMLElement>(selector: string): T => {
    const found = host.document.querySelector<T>(selector);
    if (found === null) throw new Error(`the page has no ${selector}`);
    return found;
  };
  const video = el<HTMLVideoElement>("video");
  const marker = el<HTMLDivElement>(".marker");
  const lines = { first: el<HTMLParagraphElement>(".line.first"), second: el<HTMLParagraphElement>(".line.second") };
  const still = host.matchMedia(REDUCED_MOTION).matches;
  const rate = trackRate(probe.frame, probe.lastFrame);
  const ease = 2.5;

  const place = (box: Box, opacity: number) => {
    const [l, t, r, b] = box;
    marker.style.left = `${l * 100}%`;
    marker.style.top = `${t * 100}%`;
    marker.style.width = `${(r - l) * 100}%`;
    marker.style.height = `${(b - t) * 100}%`;
    marker.style.opacity = String(opacity);
  };

  const say = (line: HTMLParagraphElement, words: string, shown: boolean) => {
    if (line.textContent !== words) line.textContent = words;
    line.classList.toggle("shown", shown);
  };

  let started: number;
  let last: number;
  let shown: Box;
  let opacity: number;
  let playing: boolean;

  const tick = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const t = (now - started) / 1000;
    const phase = phaseAt(t);
    if (phase.name === "phrase") {
      say(lines.first, BEAT_WORDS.phrase, true);
      say(lines.second, BEAT_WORDS.nothing, t > NOTHING_AT);
      opacity = 0;
    } else if (phase.name === "point") {
      say(lines.first, BEAT_WORDS.point, true);
      say(lines.second, "", false);
      shown = dampBox(shown, probe.spark, dt, ease);
      opacity = damp(opacity, 1, dt, ease);
    } else {
      if (!playing) {
        playing = true;
        video.playbackRate = rate;
        void video.play();
      }
      if (video.currentTime >= secondsAt(probe.lastFrame)) video.pause();
      say(lines.first, BEAT_WORDS.track, true);
      say(lines.second, BEAT_WORDS.found(probe.hits, probe.window), t > FOUND_AT);
      const target = boxAt(probe.tracked, frameAt(video.currentTime));
      if (target !== null) shown = dampBox(shown, target, dt, ease * 2);
    }
    place(shown, opacity);
    if (phase.name !== "track" || !video.paused) host.requestAnimationFrame(tick);
  };

  const start = () => {
    video.pause();
    playing = false;
    shown = shrunk(probe.spark, 0.6);
    video.currentTime = secondsAt(probe.frame);
    if (still) {
      say(lines.first, BEAT_WORDS.track, true);
      say(lines.second, BEAT_WORDS.found(probe.hits, probe.window), true);
      place(probe.tracked.get(probe.frame) ?? probe.spark, 1);
      return;
    }
    video.addEventListener(
      "seeked",
      () => {
        started = host.performance.now();
        last = started;
        host.requestAnimationFrame(tick);
      },
      { once: true },
    );
  };

  video.src = src;
  video.muted = true;
  video.addEventListener("loadeddata", start, { once: true });
  host.document.addEventListener("keydown", (e) => {
    if (e.key === "r" || e.key === "R") start();
  });
  host.document.addEventListener("click", start);
};

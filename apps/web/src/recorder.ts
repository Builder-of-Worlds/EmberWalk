import { Device } from "@emberwalk/shared";
import type { MotionSample, Side } from "@emberwalk/shared";
import type { LightMeter } from "./light.ts";
import type { Motion } from "./motion.ts";
import { walkOrder } from "./parts.ts";
import type { Pan, StopReason, WalkMarks } from "./take-store.ts";

export const MP4_TYPES = ["video/mp4;codecs=avc1,mp4a", "video/mp4"] as const;
export const VIDEO_BITS_PER_SECOND = 4_000_000;
export const CHUNK_MS = 1000;

export const MOTION_EVERY_MS = 100;
export const MAX_MOTION_SAMPLES = 10_000;

export const IDEAL_SIZE = { width: 1280, height: 720 } as const;

export const UNKNOWN_CAMERA = "unknown";

export const cameraConstraints = (sound: boolean): MediaStreamConstraints => ({
  audio: sound,
  video: { facingMode: { ideal: "environment" }, width: { ideal: IDEAL_SIZE.width }, height: { ideal: IDEAL_SIZE.height } },
});

export const cameraDevice = (stream: MediaStream): Device | null => {
  const track = stream.getVideoTracks()[0];
  if (track === undefined) return null;
  const { width, height } = track.getSettings();
  const camera = track.label.trim().slice(0, 100) || UNKNOWN_CAMERA;
  const device = Device.safeParse({ camera, width, height });
  return device.success ? device.data : null;
};

export type CameraRefusal = "denied" | "unsupported" | "failed";

type RecorderClass = {
  new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
  isTypeSupported(type: string): boolean;
};

export type MediaEnv = {
  mediaDevices: Pick<MediaDevices, "getUserMedia"> | undefined;
  MediaRecorder: RecorderClass | undefined;
};

export type Camera = { stream: MediaStream; mimeType: string; Recorder: RecorderClass };

export const pickMimeType = (isTypeSupported: (type: string) => boolean): string | null =>
  MP4_TYPES.find((type) => isTypeSupported(type)) ?? null;

export const refusalFor = (error: unknown): CameraRefusal => {
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotSupportedError") return "unsupported";
  return "failed";
};

export const openCamera = async (env: MediaEnv, sound: boolean): Promise<Camera | { refusal: CameraRefusal }> => {
  const { mediaDevices, MediaRecorder: Recorder } = env;
  if (mediaDevices === undefined || Recorder === undefined) return { refusal: "unsupported" };
  const mimeType = pickMimeType((type) => Recorder.isTypeSupported(type));
  if (mimeType === null) return { refusal: "unsupported" };
  try {
    return { stream: await mediaDevices.getUserMedia(cameraConstraints(sound)), mimeType, Recorder };
  } catch (error) {
    return { refusal: refusalFor(error) };
  }
};

export const stopTracks = (stream: MediaStream): void => {
  for (const track of stream.getTracks()) track.stop();
};

export type Sink = {
  chunk(data: Blob): Promise<unknown>;
  mark(change: (marks: WalkMarks) => WalkMarks): Promise<unknown>;
  finish(durationMs: number, endedBy: StopReason): Promise<unknown>;
};

export type Clock = {
  now(): number;
  later(run: () => void, ms: number): () => void;
};

export type Recording = {
  stop(): void;
  pause(): void;
  resume(): void;
  soundOff(): void;
  propertyLine(): void;
  pan(): void;
  panning(): Side | null;
  pansLeft(): number;
  videoMs(): number;
  done: Promise<StopReason>;
};

export type Sensors = { light?: LightMeter | null; part?: Side | null };

const MAX_PANS = 4;

const endPan = (pans: Pan[] | undefined, atMs: number): Pan[] =>
  (pans ?? []).map((pan, i, all) => (i === all.length - 1 && pan.endMs === null ? { ...pan, endMs: atMs } : pan));

export const startRecording = (
  camera: Camera,
  sink: Sink,
  clock: Clock,
  maxMs: number,
  motion: Motion = null,
  { light = null, part = null }: Sensors = {},
): Recording => {
  const recorder = new camera.Recorder(camera.stream, {
    mimeType: camera.mimeType,
    videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
  });
  const startedAt = clock.now();
  let endedBy: StopReason = "stopped";
  let writes: Promise<unknown> = Promise.resolve();
  let pausedAt: number | null = null;
  let pausedMs = 0;
  let soundOffAtMs: number | null = null;
  let samples: MotionSample[] = [];
  const taken: MotionSample[] = [];
  let lastSampleMs = -Infinity;
  let panSide: Side | null = null;
  let pansTaken = 0;

  const videoMs = () => (pausedAt ?? clock.now()) - startedAt - pausedMs;
  const queue = (work: () => Promise<unknown>) => {
    writes = writes.then(work).catch(fail);
  };
  const mark = (change: (marks: WalkMarks) => WalkMarks) => queue(() => sink.mark(change));

  const stopNow = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  const fail = () => {
    endedBy = "failed";
    stopNow();
  };
  const limit = () => {
    endedBy = "time_limit";
    stopNow();
  };
  let cancelLimit = clock.later(limit, maxMs);

  const flushMotion = () => {
    if (samples.length === 0) return;
    const batch = samples;
    samples = [];
    mark((marks) => ({ ...marks, motion: [...marks.motion, ...batch] }));
  };
  const stopListening =
    motion?.listen((bearing) => {
      if (pausedAt !== null || recorder.state !== "recording" || taken.length >= MAX_MOTION_SAMPLES) return;
      const at = videoMs();
      if (at - lastSampleMs < MOTION_EVERY_MS) return;
      lastSampleMs = at;
      const lux = light?.read() ?? null;
      const sample = { t: at / 1000, ...bearing, ...(lux === null ? {} : { light: lux }) };
      taken.push(sample);
      samples.push(sample);
    }) ?? (() => undefined);

  const panSides = (): readonly Side[] => (part === null ? walkOrder(taken).slice(0, MAX_PANS) : [part]);
  const closePan = (atMs: number) => {
    if (panSide === null) return;
    panSide = null;
    mark((marks) => ({ ...marks, pans: endPan(marks.pans, atMs) }));
  };

  const endPause = () => {
    if (pausedAt === null) return;
    const atMs = videoMs();
    const forMs = clock.now() - pausedAt;
    pausedMs += forMs;
    pausedAt = null;
    mark((marks) => ({ ...marks, pauses: [...marks.pauses, { atMs, forMs }] }));
  };

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) queue(() => sink.chunk(event.data));
    flushMotion();
  };
  recorder.onerror = fail;

  const done = new Promise<StopReason>((resolve, reject) => {
    recorder.onstop = () => {
      cancelLimit();
      stopListening();
      light?.stop();
      endPause();
      flushMotion();
      closePan(videoMs());
      stopTracks(camera.stream);
      const durationMs = videoMs();
      writes
        .then(() => sink.finish(durationMs, endedBy))
        .then(() => resolve(endedBy), reject);
    };
  });

  recorder.start(CHUNK_MS);
  return {
    stop: stopNow,
    pause: () => {
      if (recorder.state !== "recording") return;
      recorder.pause();
      pausedAt = clock.now();
      cancelLimit();
    },
    resume: () => {
      if (recorder.state !== "paused") return;
      endPause();
      recorder.resume();
      cancelLimit = clock.later(limit, maxMs - videoMs());
    },
    soundOff: () => {
      for (const track of camera.stream.getAudioTracks()) track.enabled = false;
      if (soundOffAtMs !== null || recorder.state === "inactive") return;
      const atMs = videoMs();
      soundOffAtMs = atMs;
      mark((marks) => ({ ...marks, soundOffAtMs: atMs }));
    },
    propertyLine: () => {
      if (recorder.state !== "recording") return;
      const atMs = videoMs();
      mark((marks) => ({ ...marks, propertyLines: [...marks.propertyLines, atMs] }));
    },
    pan: () => {
      if (recorder.state !== "recording") return;
      const atMs = videoMs();
      if (panSide !== null) return closePan(atMs);
      const side = panSides()[pansTaken];
      if (side === undefined) return;
      panSide = side;
      pansTaken += 1;
      mark((marks) => ({ ...marks, pans: [...(marks.pans ?? []), { side, startMs: atMs, endMs: null }] }));
    },
    panning: () => panSide,
    pansLeft: () => panSides().length - pansTaken,
    videoMs,
    done,
  };
};

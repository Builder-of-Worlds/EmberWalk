import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { vi } from "vitest";
import { once } from "../../src/deps.ts";
import { storageFindingMarks } from "../../src/finding-marks.ts";
import { storagePrefs } from "../../src/prefs.ts";
import type { Deps } from "../../src/deps.ts";
import type { Bearing, MotionEnv } from "../../src/motion.ts";
import type { Clock, MediaEnv } from "../../src/recorder.ts";
import { openTakeStore } from "../../src/take-store.ts";

export class FakeRecorder {
  static supported = new Set<string>(["video/mp4"]);
  static last: FakeRecorder | null = null;
  static isTypeSupported(type: string): boolean {
    return FakeRecorder.supported.has(type);
  }

  state: "inactive" | "recording" | "paused" = "inactive";
  timeslice: number | undefined;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    readonly stream: MediaStream,
    readonly options: MediaRecorderOptions,
  ) {
    FakeRecorder.last = this;
  }

  start(timeslice?: number): void {
    this.state = "recording";
    this.timeslice = timeslice;
  }

  pause(): void {
    if (this.state !== "recording") throw new Error("pause() when not recording");
    this.state = "paused";
  }

  resume(): void {
    if (this.state !== "paused") throw new Error("resume() when not paused");
    this.state = "recording";
  }

  stop(): void {
    if (this.state === "inactive") throw new Error("stop() on an inactive recorder");
    this.state = "inactive";
    queueMicrotask(() => this.onstop?.());
  }

  emit(text: string): void {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
}

export const FAKE_CAMERA = { label: "Back Camera", width: 1280, height: 720 };

export const fakeStream = (sound = true, camera: Partial<typeof FAKE_CAMERA> = FAKE_CAMERA) => {
  const settings = { width: camera.width, height: camera.height };
  const track = { kind: "video", enabled: true, stop: vi.fn(), label: camera.label ?? "", getSettings: () => settings };
  const audio = { kind: "audio", enabled: true, stop: vi.fn() };
  const tracks = sound ? [track, audio] : [track];
  const stream = Object.assign(Object.create(MediaStream.prototype) as MediaStream, {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  });
  return { stream, track, audio };
};

export const fakeMotion = () => {
  const listeners = new Set<(bearing: Bearing) => void>();
  const requestPermission = vi.fn(async () => "granted");
  const env: MotionEnv = {
    requestPermission,
    listen: (on) => {
      listeners.add(on);
      return () => listeners.delete(on);
    },
  };
  const turn = (headingDegrees: number, tiltDegrees = 0) => {
    for (const on of listeners) on({ headingDegrees, tiltDegrees });
  };
  return { env, requestPermission, turn, listening: () => listeners.size };
};

export const fakeClock = (start = 1_000_000) => {
  let now = start;
  let timers: { at: number; run: () => void }[] = [];
  const clock: Clock = {
    now: () => now,
    later: (run, ms) => {
      const timer = { at: now + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((t) => t !== timer);
      };
    },
  };
  const advance = (ms: number) => {
    now += ms;
    const due = timers.filter((t) => t.at <= now);
    timers = timers.filter((t) => t.at > now);
    for (const t of due) t.run();
  };
  return { clock, advance, pending: () => timers.length };
};

export const grantedMedia = (): MediaEnv & { getUserMedia: ReturnType<typeof vi.fn> } => {
  const getUserMedia = vi.fn(async (constraints?: MediaStreamConstraints) => fakeStream(constraints?.audio !== false).stream);
  return { mediaDevices: { getUserMedia }, MediaRecorder: FakeRecorder as unknown as MediaEnv["MediaRecorder"], getUserMedia };
};

export const deniedError = () => Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });

export const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
};

export const memoryPrefs = (storage = memoryStorage()) => storagePrefs(() => storage);

export const refusingStorage = (): Storage => {
  throw Object.assign(new Error("The operation is insecure."), { name: "SecurityError" });
};

export const memoryMarks = (storage = memoryStorage()) => storageFindingMarks(() => storage);

export const testDeps = (overrides: Partial<Deps> = {}): Deps => {
  const idb = new IDBFactory();
  return {
    media: grantedMedia(),
    takes: once(() => openTakeStore(idb)),
    clock: fakeClock().clock,
    maxWalkMs: 360_000,
    send: async () => ({ code: "offline" }),
    prefs: memoryPrefs(),
    motion: null,
    locate: async () => ({ refusal: "unsupported" }),
    results: async () => null,
    stills: async () => null,
    marks: memoryMarks(),
    ...overrides,
  };
};

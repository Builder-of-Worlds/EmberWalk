import { afterEach, describe, expect, it, vi } from "vitest";
import type { Motion } from "../../src/motion.ts";
import {
  cameraConstraints,
  cameraDevice,
  CHUNK_MS,
  MAX_MOTION_SAMPLES,
  MOTION_EVERY_MS,
  openCamera,
  pickMimeType,
  refusalFor,
  startRecording,
  VIDEO_BITS_PER_SECOND,
} from "../../src/recorder.ts";
import type { Camera, Sensors } from "../../src/recorder.ts";
import { NO_MARKS } from "../../src/take-store.ts";
import type { WalkMarks } from "../../src/take-store.ts";
import { deniedError, fakeClock, fakeMotion, FakeRecorder, fakeStream, grantedMedia } from "./fakes.ts";

afterEach(() => {
  FakeRecorder.supported = new Set(["video/mp4"]);
});

describe("pickMimeType", () => {
  it("prefers MP4 with named codecs, then plain MP4", () => {
    expect(pickMimeType(() => true)).toBe("video/mp4;codecs=avc1,mp4a");
    expect(pickMimeType((t) => t === "video/mp4")).toBe("video/mp4");
  });

  it("gives nothing when the browser records only other formats, since the API accepts MP4 only", () => {
    expect(pickMimeType((t) => t.startsWith("video/webm"))).toBeNull();
  });
});

describe("refusalFor", () => {
  it("reads a refused permission as denied", () => {
    expect(refusalFor(deniedError())).toBe("denied");
    expect(refusalFor({ name: "SecurityError" })).toBe("denied");
  });

  it("reads a missing or unfit camera as unsupported", () => {
    for (const name of ["NotFoundError", "OverconstrainedError", "NotSupportedError"]) expect(refusalFor({ name })).toBe("unsupported");
  });

  it("reads anything else as failed", () => {
    expect(refusalFor({ name: "NotReadableError" })).toBe("failed");
    expect(refusalFor("boom")).toBe("failed");
    expect(refusalFor(null)).toBe("failed");
  });
});

describe("cameraDevice", () => {
  it("reads the camera's name and picture size from the video track", () => {
    expect(cameraDevice(fakeStream(true, { label: "  Back Camera  ", width: 1920, height: 1080 }).stream)).toEqual({
      camera: "Back Camera",
      width: 1920,
      height: 1080,
    });
  });

  it("names an unnamed camera unknown and cuts a long name to what the API takes", () => {
    expect(cameraDevice(fakeStream(true, { label: " ", width: 640, height: 480 }).stream)?.camera).toBe("unknown");
    expect(cameraDevice(fakeStream(true, { label: "x".repeat(150), width: 640, height: 480 }).stream)?.camera).toBe("x".repeat(100));
  });

  it("gives nothing when the size is missing or not a real picture size", () => {
    expect(cameraDevice(fakeStream(true, { label: "Back Camera" }).stream)).toBeNull();
    expect(cameraDevice(fakeStream(true, { label: "Back Camera", width: 0, height: 720 }).stream)).toBeNull();
    expect(cameraDevice(fakeStream(true, { label: "Back Camera", width: 1280.5, height: 720 }).stream)).toBeNull();
  });

  it("gives nothing for a stream with no video track", () => {
    const { stream } = fakeStream();
    expect(cameraDevice(Object.assign(stream, { getVideoTracks: () => [] }))).toBeNull();
  });
});

describe("openCamera", () => {
  it("asks for the rear camera with sound and returns the stream and MP4 format", async () => {
    const media = grantedMedia();
    const camera = await openCamera(media, true);
    expect(media.getUserMedia).toHaveBeenCalledWith(cameraConstraints(true));
    expect(cameraConstraints(true).audio).toBe(true);
    expect(cameraConstraints(true).video).toMatchObject({ facingMode: { ideal: "environment" } });
    expect(camera).toMatchObject({ mimeType: "video/mp4" });
  });

  it("with sound off, never asks for the microphone and gets no sound track", async () => {
    const media = grantedMedia();
    const camera = await openCamera(media, false);
    expect(media.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    expect("stream" in camera && camera.stream.getAudioTracks()).toEqual([]);
  });

  it("refuses as unsupported when the browser has no camera access or no recorder", async () => {
    expect(await openCamera({ mediaDevices: undefined, MediaRecorder: grantedMedia().MediaRecorder }, true)).toEqual({ refusal: "unsupported" });
    expect(await openCamera({ mediaDevices: grantedMedia().mediaDevices, MediaRecorder: undefined }, true)).toEqual({ refusal: "unsupported" });
  });

  it("refuses as unsupported without asking for the camera when MP4 recording is missing", async () => {
    FakeRecorder.supported = new Set(["video/webm"]);
    const media = grantedMedia();
    expect(await openCamera(media, true)).toEqual({ refusal: "unsupported" });
    expect(media.getUserMedia).not.toHaveBeenCalled();
  });

  it("refuses as denied when permission is refused", async () => {
    const media = grantedMedia();
    media.getUserMedia.mockRejectedValueOnce(deniedError());
    expect(await openCamera(media, true)).toEqual({ refusal: "denied" });
  });
});

const record = (maxMs = 10_000, motion: Motion = null, sensors: Sensors = {}) => {
  const { stream, track, audio } = fakeStream();
  const camera = { stream, mimeType: "video/mp4", Recorder: FakeRecorder } as unknown as Camera;
  const written: string[] = [];
  const finished: [number, string][] = [];
  let marks: WalkMarks = NO_MARKS;
  const sink = {
    chunk: vi.fn(async (data: Blob) => written.push(await data.text())),
    mark: vi.fn(async (change: (m: WalkMarks) => WalkMarks) => (marks = change(marks))),
    finish: vi.fn(async (ms: number, why: string) => finished.push([ms, why])),
  };
  const time = fakeClock();
  const recording = startRecording(camera, sink, time.clock, maxMs, motion, sensors);
  const recorder = FakeRecorder.last as FakeRecorder;
  return { recording, recorder, written, finished, sink, time, track, audio, marks: () => marks };
};

describe("startRecording", () => {
  it("records MP4 at the walk bitrate in one second chunks", () => {
    const { recorder } = record();
    expect(recorder.options).toEqual({ mimeType: "video/mp4", videoBitsPerSecond: VIDEO_BITS_PER_SECOND });
    expect(recorder.timeslice).toBe(CHUNK_MS);
    expect(recorder.state).toBe("recording");
  });

  it("saves each chunk in order, skips empty ones, and finishes with the length when stopped", async () => {
    const { recording, recorder, written, finished, time, track } = record();
    recorder.emit("one");
    recorder.emit("");
    recorder.emit("two");
    time.advance(2500);
    recording.stop();
    expect(await recording.done).toBe("stopped");
    expect(written).toEqual(["one", "two"]);
    expect(finished).toEqual([[2500, "stopped"]]);
    expect(track.stop).toHaveBeenCalled();
  });

  it("stops by itself at the time limit and says so", async () => {
    const { recording, finished, time } = record(6000);
    time.advance(5999);
    expect(FakeRecorder.last?.state).toBe("recording");
    time.advance(1);
    expect(await recording.done).toBe("time_limit");
    expect(finished).toEqual([[6000, "time_limit"]]);
  });

  it("cancels the time limit once stopped by hand", async () => {
    const { recording, time } = record(6000);
    recording.stop();
    await recording.done;
    expect(time.pending()).toBe(0);
  });

  it("stops and keeps what was saved when the recorder fails", async () => {
    const { recording, recorder, finished } = record();
    recorder.emit("one");
    recorder.onerror?.();
    expect(await recording.done).toBe("failed");
    expect(finished[0]?.[1]).toBe("failed");
  });

  it("stops as failed when the phone cannot save a chunk", async () => {
    const { recording, recorder, sink, finished } = record();
    sink.chunk.mockRejectedValueOnce(new Error("quota"));
    recorder.emit("one");
    expect(await recording.done).toBe("failed");
    expect(finished[0]?.[1]).toBe("failed");
  });

  it("ignores a second stop", async () => {
    const { recording } = record();
    recording.stop();
    recording.stop();
    expect(await recording.done).toBe("stopped");
  });
});

describe("walk controls", () => {
  it("Sound Off stops sound reaching the take from that moment and says when", async () => {
    const { recording, audio, time, marks } = record();
    time.advance(1200);
    recording.soundOff();
    expect(audio.enabled).toBe(false);
    time.advance(500);
    recording.soundOff();
    recording.stop();
    await recording.done;
    expect(marks().soundOffAtMs).toBe(1200);
  });

  it("Pause stops the recorder, leaves a gap mark, and holds the time limit", async () => {
    const { recording, recorder, time, marks, finished } = record(6000);
    time.advance(2000);
    recording.pause();
    expect(recorder.state).toBe("paused");
    time.advance(10_000);
    expect(recorder.state).toBe("paused");
    expect(recording.videoMs()).toBe(2000);
    recording.resume();
    expect(recorder.state).toBe("recording");
    time.advance(3999);
    expect(recorder.state).toBe("recording");
    time.advance(1);
    expect(await recording.done).toBe("time_limit");
    expect(marks().pauses).toEqual([{ atMs: 2000, forMs: 10_000 }]);
    expect(finished).toEqual([[6000, "time_limit"]]);
  });

  it("ignores pause when stopped and resume when not paused, and closes a pause left open at the end", async () => {
    const { recording, time, marks, finished } = record();
    recording.resume();
    time.advance(1000);
    recording.pause();
    recording.pause();
    time.advance(700);
    recording.stop();
    await recording.done;
    recording.pause();
    expect(marks().pauses).toEqual([{ atMs: 1000, forMs: 700 }]);
    expect(finished).toEqual([[1000, "stopped"]]);
  });

  it("Property Line marks the moment in the video, and not while paused", async () => {
    const { recording, time, marks } = record();
    time.advance(1500);
    recording.propertyLine();
    recording.pause();
    time.advance(4000);
    recording.propertyLine();
    recording.resume();
    time.advance(500);
    recording.propertyLine();
    recording.stop();
    await recording.done;
    expect(marks().propertyLines).toEqual([1500, 2000]);
  });

  it("keeps motion samples on video time, at most one each tenth of a second, none while paused", async () => {
    const motion = fakeMotion();
    const { recording, recorder, time, marks } = record(10_000, { listen: motion.env.listen });
    motion.turn(10, 5);
    time.advance(50);
    motion.turn(20);
    time.advance(50);
    motion.turn(30);
    recorder.emit("one");
    recording.pause();
    time.advance(1000);
    motion.turn(90);
    recording.resume();
    time.advance(400);
    motion.turn(120, -3);
    recording.stop();
    await recording.done;
    expect(marks().motion).toEqual([
      { t: 0, headingDegrees: 10, tiltDegrees: 5 },
      { t: 0.1, headingDegrees: 30, tiltDegrees: 0 },
      { t: 0.5, headingDegrees: 120, tiltDegrees: -3 },
    ]);
    expect(motion.listening()).toBe(0);
  });

  it("stops keeping motion at the sample cap", async () => {
    const motion = fakeMotion();
    const { recording, time, marks } = record(10_000_000, { listen: motion.env.listen });
    for (let i = 0; i < MAX_MOTION_SAMPLES + 5; i += 1) {
      motion.turn(i % 360);
      time.advance(MOTION_EVERY_MS);
    }
    recording.stop();
    await recording.done;
    expect(marks().motion).toHaveLength(MAX_MOTION_SAMPLES);
  });
});

const meterOf = (readings: (number | null)[]) => {
  let i = 0;
  return { read: vi.fn(() => readings[Math.min(i++, readings.length - 1)] ?? null), stop: vi.fn() };
};

describe("light", () => {
  it("keeps the camera's light with each motion sample, leaves it out when the camera gives none, and stops the meter with the walk", async () => {
    const motion = fakeMotion();
    const light = meterOf([120, null, 64]);
    const { recording, time, marks } = record(10_000, { listen: motion.env.listen }, { light });
    motion.turn(10);
    time.advance(MOTION_EVERY_MS);
    motion.turn(20);
    time.advance(MOTION_EVERY_MS);
    motion.turn(30);
    recording.stop();
    await recording.done;
    expect(marks().motion).toEqual([
      { t: 0, headingDegrees: 10, tiltDegrees: 0, light: 120 },
      { t: 0.1, headingDegrees: 20, tiltDegrees: 0 },
      { t: 0.2, headingDegrees: 30, tiltDegrees: 0, light: 64 },
    ]);
    expect(light.stop).toHaveBeenCalledOnce();
  });

  it("reads no light between motion samples", () => {
    const motion = fakeMotion();
    const light = meterOf([120]);
    const { time } = record(10_000, { listen: motion.env.listen }, { light });
    motion.turn(10);
    time.advance(50);
    motion.turn(20);
    expect(light.read).toHaveBeenCalledOnce();
  });
});

describe("side pans after the loop", () => {
  const corner = (motion: ReturnType<typeof fakeMotion>, time: ReturnType<typeof fakeClock>, headings: number[]) => {
    for (const heading of headings) {
      motion.turn(heading);
      time.advance(MOTION_EVERY_MS);
    }
  };

  it("Pan the Yard marks each pan's start and end on video time, naming the sides in the order the loop turned", async () => {
    const motion = fakeMotion();
    const { recording, time, marks } = record(100_000, { listen: motion.env.listen });
    corner(motion, time, [0, 45, 95, 140, 185, 230, 275, 320, 5]);
    expect(recording.panning()).toBeNull();
    expect(recording.pansLeft()).toBe(4);
    for (const side of ["front", "left", "back", "right"]) {
      recording.pan();
      expect(recording.panning()).toBe(side);
      time.advance(2000);
      recording.pan();
      expect(recording.panning()).toBeNull();
      time.advance(1000);
    }
    expect(recording.pansLeft()).toBe(0);
    recording.pan();
    expect(recording.panning()).toBeNull();
    recording.stop();
    await recording.done;
    expect(marks().pans).toEqual([
      { side: "front", startMs: 900, endMs: 2900 },
      { side: "left", startMs: 3900, endMs: 5900 },
      { side: "back", startMs: 6900, endMs: 8900 },
      { side: "right", startMs: 9900, endMs: 11_900 },
    ]);
  });

  it("closes a pan left open when the walk stops, and starts none while paused", async () => {
    const { recording, time, marks } = record(100_000);
    recording.pause();
    recording.pan();
    expect(recording.panning()).toBeNull();
    recording.resume();
    time.advance(1000);
    recording.pan();
    expect(recording.panning()).toBe("front");
    time.advance(1500);
    recording.stop();
    await recording.done;
    expect(marks().pans).toEqual([{ side: "front", startMs: 1000, endMs: 2500 }]);
  });

  it("pans only the one side of a walk of one side, once", async () => {
    const { recording, time, marks } = record(100_000, null, { part: "back" });
    recording.pan();
    expect(recording.panning()).toBe("back");
    time.advance(1000);
    recording.pan();
    recording.pan();
    expect(recording.panning()).toBeNull();
    expect(recording.pansLeft()).toBe(0);
    recording.stop();
    await recording.done;
    expect(marks().pans).toEqual([{ side: "back", startMs: 0, endMs: 1000 }]);
  });
});

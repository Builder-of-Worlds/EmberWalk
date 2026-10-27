import { MotionSample } from "@emberwalk/shared";
import { z } from "zod";
import { ImportError } from "./errors.ts";
import type { RenderSource, VideoSource } from "./source.ts";

export const SYNTHETIC_LABEL = "Synthetic sample house";

const MAX_SAMPLES = 10_000;
const LENGTH_TOLERANCE_SECONDS = 0.001;
const Scene = z.string().min(1).max(100);

const RenderFile = z.looseObject({
  schema: z.literal("emberwalk.render/1"),
  scene: Scene,
  file: z.string().min(1).max(200),
  size_bytes: z.int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.int().positive().max(8192),
  height: z.int().positive().max(8192),
  fps: z.number().positive().max(60),
  duration_s: z.number().positive(),
  frame_count: z.int().positive(),
});

const MotionFile = z.looseObject({
  schema: z.literal("emberwalk.motion/1"),
  scene: Scene,
  fps: z.number().positive().max(60),
  duration_s: z.number().positive(),
  frame_count: z.int().positive(),
  samples: z.array(z.looseObject({ t: z.number(), tilt_deg: z.number(), heading_deg: z.number() })).min(1).max(MAX_SAMPLES),
});

export type CheckedRender = {
  scene: string;
  width: number;
  height: number;
  durationSeconds: number;
  samples: MotionSample[];
  video: VideoSource;
};

const markedSynthetic = (file: string, json: unknown): void => {
  const fields = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  if (fields["synthetic"] !== true) throw new ImportError("not_synthetic", `${file} is not marked synthetic.`);
  if (fields["label"] !== SYNTHETIC_LABEL) throw new ImportError("not_labelled", `${file} is not labelled "${SYNTHETIC_LABEL}".`);
};

const read = async (source: RenderSource, name: "render.json" | "motion.json"): Promise<unknown> => {
  try {
    return await source.json(name);
  } catch {
    throw new ImportError("render_unreadable", `${name} could not be read from the render folder.`);
  }
};

const videoName = (path: string): string => {
  const name = path.split("/").pop() ?? "";
  if (name === "" || name === "." || name === "..") throw new ImportError("invalid_render", "render.json names no video file.");
  return name;
};

export const checkRender = async (source: RenderSource): Promise<CheckedRender> => {
  const renderJson = await read(source, "render.json");
  markedSynthetic("render.json", renderJson);
  const motionJson = await read(source, "motion.json");
  markedSynthetic("motion.json", motionJson);

  const render = RenderFile.safeParse(renderJson);
  if (!render.success) throw new ImportError("invalid_render", "render.json is missing a field or has one out of range.");
  const motion = MotionFile.safeParse(motionJson);
  if (!motion.success) throw new ImportError("invalid_motion", "motion.json is missing a field or has one out of range.");
  const samples = z
    .array(MotionSample)
    .safeParse(motion.data.samples.map((s) => ({ t: s.t, tiltDegrees: s.tilt_deg, headingDegrees: s.heading_deg })));
  if (!samples.success) throw new ImportError("invalid_motion", "motion.json has a sample out of range.");

  if (render.data.scene !== motion.data.scene) {
    throw new ImportError("scene_mismatch", `render.json is scene ${render.data.scene} and motion.json is scene ${motion.data.scene}.`);
  }
  const sameLength =
    render.data.frame_count === motion.data.frame_count &&
    render.data.fps === motion.data.fps &&
    Math.abs(render.data.duration_s - motion.data.duration_s) <= LENGTH_TOLERANCE_SECONDS;
  if (!sameLength) throw new ImportError("length_mismatch", "render.json and motion.json do not describe the same length of walk.");

  const video = await source.video(videoName(render.data.file));
  if (video === null) throw new ImportError("video_missing", "The video named in render.json is not in the render folder.");
  if (video.sizeBytes !== render.data.size_bytes) {
    throw new ImportError("video_size_mismatch", `The video is ${video.sizeBytes} bytes and render.json says ${render.data.size_bytes}.`);
  }
  if ((await video.sha256()) !== render.data.sha256) {
    throw new ImportError("video_hash_mismatch", "The video does not match the sha256 in render.json.");
  }
  return {
    scene: render.data.scene,
    width: render.data.width,
    height: render.data.height,
    durationSeconds: motion.data.duration_s,
    samples: samples.data,
    video,
  };
};

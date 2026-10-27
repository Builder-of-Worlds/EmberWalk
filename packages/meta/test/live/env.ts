import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const META_BASE_URL = "https://api.meta.ai/v1";

export function metaKey(): string {
  const file = path.join(REPO, ".dev.vars");
  if (existsSync(file)) {
    const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => l.startsWith("META_API_KEY="));
    const value = line?.slice("META_API_KEY=".length).trim().replace(/^"(.*)"$/, "$1");
    if (value) return value;
  }
  const env = process.env["META_API_KEY"]?.trim();
  if (!env) throw new Error("META_API_KEY is in neither .dev.vars nor the environment");
  return env;
}

export function requireLive(): void {
  if (process.env["EMBERWALK_LIVE"] !== "1") throw new Error("live tests run only with EMBERWALK_LIVE=1; they cost money");
}

type Vec = [number, number, number];
export type FrameBox = { frame: number; t: number; box_px: [number, number, number, number]; area_px: number };
export type Hazard = { id: string; concept: string; visible_s: [number, number][]; box_in: { min: Vec; max: Vec }; frame_boxes?: FrameBox[] };
export type Truth = { synthetic: boolean; label: string; hazards: Hazard[] };
export type RenderInfo = { synthetic: boolean; file: string; sha256: string; fps: number; frame_count: number };
export type Pose = { t: number; pos_in: Vec; heading_deg: number; tilt_deg: number; roll_deg: number };
export type Camera = { width_px: number; height_px: number; focal_mm: number; sensor_width_mm: number };
export type Motion = { fps: number; camera: Camera; samples: Pose[] };
export type Rect = { left: number; top: number; right: number; bottom: number };

export const YARD_ONE = "test-yard";
export const YARD_TWO = "test-yard-2";

const fixture = <T>(name: string, yard: string): T => JSON.parse(readFileSync(path.join(REPO, "fixtures/synthetic", yard, name), "utf8")) as T;
export const truth = (yard = YARD_ONE): Truth => fixture<Truth>("truth.json", yard);
export const renderInfo = (yard = YARD_ONE): RenderInfo => fixture<RenderInfo>("render.json", yard);
export const motion = (yard = YARD_ONE): Motion => fixture<Motion>("motion.json", yard);

type Mat = [Vec, Vec, Vec];
const mul = (a: Mat, b: Mat): Mat =>
  [0, 1, 2].map((i) => [0, 1, 2].map((j) => a[i]![0] * b[0]![j]! + a[i]![1] * b[1]![j]! + a[i]![2] * b[2]![j]!)) as Mat;
const rotX = (r: number): Mat => [[1, 0, 0], [0, Math.cos(r), -Math.sin(r)], [0, Math.sin(r), Math.cos(r)]];
const rotZ = (r: number): Mat => [[Math.cos(r), -Math.sin(r), 0], [Math.sin(r), Math.cos(r), 0], [0, 0, 1]];
const rad = (d: number): number => (d * Math.PI) / 180;

const NEAR_IN = 1;

export function toCamera(point: Vec, pose: Pose): Vec {
  const r = mul(mul(rotZ(rad(-pose.heading_deg)), rotX(rad(90 - pose.tilt_deg))), rotZ(rad(-pose.roll_deg)));
  const rel = [0, 1, 2].map((i) => point[i]! - pose.pos_in[i]!) as Vec;
  return [0, 1, 2].map((j) => r[0][j]! * rel[0] + r[1][j]! * rel[1] + r[2][j]! * rel[2]) as Vec;
}

export function toImage([x, y, z]: Vec, camera: Camera): [number, number] {
  const f = (camera.focal_mm / camera.sensor_width_mm) * camera.width_px;
  return [camera.width_px / 2 + (f * x) / -z, camera.height_px / 2 - (f * y) / -z];
}

export function truthRect(hazard: Hazard, m: Motion, t: number): Rect | null {
  const pose = m.samples[Math.min(m.samples.length - 1, Math.max(0, Math.round(t * m.fps)))]!;
  const { min, max } = hazard.box_in;
  const corners: Vec[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) corners.push(toCamera([x, y, z], pose));
  const front = corners.filter((c) => c[2] <= -NEAR_IN);
  for (const [i, a] of corners.entries()) {
    for (const [j, b] of corners.entries()) {
      if (j <= i || ![1, 2, 4].includes(i ^ j)) continue;
      if ((a[2] <= -NEAR_IN) === (b[2] <= -NEAR_IN)) continue;
      const s = (-NEAR_IN - a[2]) / (b[2] - a[2]);
      front.push([a[0] + s * (b[0] - a[0]), a[1] + s * (b[1] - a[1]), -NEAR_IN]);
    }
  }
  const uv = front.map((c) => toImage(c, m.camera));
  if (uv.length === 0) return null;
  const rect = {
    left: Math.max(0, Math.min(...uv.map((p) => p[0]))),
    top: Math.max(0, Math.min(...uv.map((p) => p[1]))),
    right: Math.min(m.camera.width_px, Math.max(...uv.map((p) => p[0]))),
    bottom: Math.min(m.camera.height_px, Math.max(...uv.map((p) => p[1]))),
  };
  return rect.right > rect.left && rect.bottom > rect.top ? rect : null;
}

const area = (r: Rect): number => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);

export function iou(a: Rect, b: Rect): number {
  const inter = area({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
  const union = area(a) + area(b) - inter;
  return union > 0 ? inter / union : 0;
}

export function syntheticRender(yard = YARD_ONE): string {
  const info = renderInfo(yard);
  const root = process.env["EMBERWALK_RENDERS"] ?? path.join(homedir(), "emberwalk-renders");
  const file = path.join(root, info.file);
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (!info.synthetic || sha !== info.sha256) throw new Error(`${file} is not the synthetic render named in render.json`);
  return file;
}

export function reencode(input: string, output: string, fps: number): number {
  execFileSync("ffmpeg", [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", input,
    "-vf", `fps=${fps}`,
    "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", output,
  ]);
  const out = execFileSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", output,
  ]).toString();
  return Number(out.trim());
}

export function frameJpeg(clip: string, index: number, width: number): Uint8Array {
  if (!Number.isInteger(index) || index < 0) throw new TypeError("a frame index is a whole number from 0");
  return execFileSync(
    "ffmpeg",
    ["-hide_banner", "-nostdin", "-loglevel", "error", "-i", clip, "-vf", `select=eq(n\\,${index}),scale=${width}:-2`, "-frames:v", "1", "-q:v", "3", "-f", "image2pipe", "-c:v", "mjpeg", "-"],
    { maxBuffer: 32 * 1024 * 1024 },
  );
}

export const MIN_IOU = 0.5;

export type Match = { window: number[]; hits: number[]; elsewhere: number[]; bestIou: Map<number, number> };

export function matchHazard(hazard: Hazard, found: { frame: number; objects: { box: Rect }[] }[], m: Motion, fps: number): Match {
  const window = windowFrames(hazard.visible_s, fps);
  const bestIou = new Map<number, number>();
  const elsewhere: number[] = [];
  for (const f of found) {
    if (f.objects.length === 0) continue;
    const rect = truthRect(hazard, m, f.frame / fps);
    const best = rect === null ? 0 : Math.max(...f.objects.map((o) => iou(o.box, rect)));
    bestIou.set(f.frame, best);
    if (best < MIN_IOU) elsewhere.push(f.frame);
  }
  const hits = window.filter((f) => (bestIou.get(f) ?? 0) >= MIN_IOU);
  return { window, hits, elsewhere, bestIou };
}

export function windowFrames(visible: [number, number][], fps: number): number[] {
  const frames: number[] = [];
  for (const [from, to] of visible) {
    for (let f = Math.ceil(from * fps); f <= Math.floor(to * fps); f++) frames.push(f);
  }
  return frames;
}

import { env, exports } from "cloudflare:workers";
import { s3StandIn } from "../../../../workers/api/test/s3-standin.ts";
import type { Fetch, RenderSource } from "../../src/index.ts";
import { SYNTHETIC_LABEL } from "../../src/index.ts";

export const SCENE = "test-yard-2";
export const ORIGIN = "https://api.test";

export const sha256Hex = async (bytes: Uint8Array): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join("");

type Json = Record<string, unknown>;

export const motionFile = (over: Json = {}): Json => ({
  schema: "emberwalk.motion/1",
  synthetic: true,
  label: SYNTHETIC_LABEL,
  scene: SCENE,
  fps: 30,
  frame_count: 60,
  duration_s: 2,
  samples: Array.from({ length: 60 }, (_, i) => ({
    frame: i + 1,
    t: i / 30,
    pos_in: [72, 192, 54],
    heading_deg: 180 + i / 10,
    tilt_deg: 17 + i / 20,
    roll_deg: 0.5,
  })),
  ...over,
});

export const renderFile = async (video: Uint8Array, over: Json = {}): Promise<Json> => ({
  schema: "emberwalk.render/1",
  synthetic: true,
  label: SYNTHETIC_LABEL,
  scene: SCENE,
  file: `${SCENE}/walk.mp4`,
  size_bytes: video.length,
  sha256: await sha256Hex(video),
  width: 1920,
  height: 1080,
  fps: 30,
  duration_s: 2,
  frame_count: 60,
  ...over,
});

export type Folder = { render: unknown; motion: unknown; video: Uint8Array | null };

export const goodFolder = async (video: Uint8Array): Promise<Folder> => ({
  render: await renderFile(video),
  motion: motionFile(),
  video,
});

export const memoryRender = (folder: Folder): RenderSource => ({
  async json(name) {
    const value = name === "render.json" ? folder.render : folder.motion;
    if (value === undefined) throw new Error(`${name} is missing`);
    return value;
  },
  async video(fileName) {
    const bytes = folder.video;
    if (bytes === null || fileName !== "walk.mp4") return null;
    return { sizeBytes: bytes.length, sha256: () => sha256Hex(bytes), read: async (from, to) => bytes.slice(from, to) };
  },
});

export type Seen = { method: string; host: string; path: string };

export type Intercept = (request: Request) => Response | Promise<Response> | undefined;

export const apiFetch = (seen: Seen[], intercept: Intercept = () => undefined): Fetch => {
  return async (request) => {
    const url = new URL(request.url);
    seen.push({ method: request.method, host: url.hostname, path: url.pathname });
    const early = await intercept(request);
    if (early !== undefined) return early;
    if (url.hostname === new URL(ORIGIN).hostname) return exports.default.fetch(request);
    return s3StandIn(request, {
      bucket: env.MEDIA,
      bucketName: env.R2_BUCKET_NAME,
      host: env.R2_HOST,
      accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
      now: () => new Date(),
    });
  };
};

export const apiPaths = (seen: Seen[]): string[] => seen.filter((s) => s.host === new URL(ORIGIN).hostname).map((s) => `${s.method} ${s.path}`);

export const refusal = (status: number, code: string): Response =>
  Response.json({ error: { code, message: `stand-in refusal ${code}` } }, { status });

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FRAME_HEIGHT = 720;

export const rendersRoot = (): string => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: here }).toString().trim();
  return path.join(path.dirname(path.dirname(common)), "emberwalk-renders");
};

export const frameDataUri = (video: string, seconds: number, height = FRAME_HEIGHT): string => {
  if (!Number.isFinite(seconds) || seconds < 0) throw new TypeError("a frame second is a number from 0");
  const cut = (): Buffer => {
    try {
      return execFileSync(
        "ffmpeg",
        ["-hide_banner", "-nostdin", "-loglevel", "error", "-ss", String(seconds), "-i", video, "-frames:v", "1", "-vf", `scale=-2:${height}`, "-q:v", "4", "-f", "image2pipe", "-c:v", "mjpeg", "-"],
        { maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
      );
    } catch {
      return Buffer.alloc(0);
    }
  };
  const jpeg = cut();
  if (jpeg.length === 0) throw new Error(`no frame at ${seconds} seconds of ${video}`);
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
};

export const syntheticWalk = (yardFolder: string, yard: string): string => {
  const info = JSON.parse(readFileSync(path.join(yardFolder, "render.json"), "utf8")) as { synthetic: boolean; file: string; sha256: string };
  const root = process.env["EMBERWALK_RENDERS"] ?? rendersRoot();
  const file = path.join(root, info.file);
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (!info.synthetic || sha !== info.sha256) throw new Error(`${file} is not the synthetic render of ${yard}`);
  return file;
};

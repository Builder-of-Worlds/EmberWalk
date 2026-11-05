import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { JUDGE_MEDIA } from "../src/judge.ts";

export const ASSET_LIMIT_BYTES = 25 * 1024 * 1024;

const footage = (): string | null => {
  try {
    const common = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const found = join(dirname(dirname(common)), "NOTES", "footage");
    return existsSync(join(found, "judges-portal")) ? found : null;
  } catch {
    return null;
  }
};

const HLS_LIBRARY = fileURLToPath(new URL("../../../node_modules/hls.js/dist/hls.light.min.js", import.meta.url));

const folder = (name: string, source: string): [string, string][] => {
  if (!existsSync(source)) throw new Error(`the judge copy needs ${source}`);
  return readdirSync(source, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(m3u8|m4s|mp4)$/.test(entry.name))
    .map((entry) => {
      const path = join(entry.parentPath, entry.name);
      return [`${name}/${relative(source, path)}`, path];
    });
};

export const mediaFiles = (root: string): [name: string, path: string][] => [
  ...folder("film", join(root, "judges-video", "hls")),
  ["judges-video.mp4", join(root, "judges-video", "judges-video-web.mp4")],
  [JUDGE_MEDIA.poster, join(root, "judges-video", "judges-video-poster.jpg")],
  ...folder("walk/desktop", join(root, "judges-portal", "walk-hls", "desktop")),
  ...(existsSync(join(root, "judges-portal", "walk-hls", "phone")) ? folder("walk/phone", join(root, "judges-portal", "walk-hls", "phone")) : []),
  [JUDGE_MEDIA.hls, HLS_LIBRARY],
  [JUDGE_MEDIA.walkPoster, join(root, "judges-portal", "walk-poster.jpg")],
  [JUDGE_MEDIA.pdf, join(root, "judges-portal", "report.pdf")],
  ...readdirSync(join(root, "judges-portal", "stills")).map((name): [string, string] => [`${JUDGE_MEDIA.stills}${name}`, join(root, "judges-portal", "stills", name)]),
];

export const checkedSource = (path: string): Buffer => {
  if (!existsSync(path)) throw new Error(`the judge copy needs ${path}`);
  const bytes = statSync(path).size;
  if (bytes > ASSET_LIMIT_BYTES) throw new Error(`${path} is ${bytes} bytes, over the Workers file limit`);
  return readFileSync(path);
};

// The videos stay out of the repository. A tree with no footage builds without them; scripts/deploy.sh and the judges' browser tests are red on that build.
export const judgeWalkPlugin = (named = process.env.EMBERWALK_JUDGE_MEDIA, found = footage): Plugin => ({
  name: "emberwalk-judge-walk",
  apply: "build",
  generateBundle() {
    const root = named ?? found();
    if (root === null) return this.warn("no judge media in this tree: the judge copy is built without its videos and cannot be deployed");
    for (const [fileName, path] of mediaFiles(resolve(root))) this.emitFile({ type: "asset", fileName, source: checkedSource(path) });
  },
});

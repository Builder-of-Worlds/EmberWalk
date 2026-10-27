import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { RenderSource, VideoSource } from "./source.ts";

const sha256Of = async (file: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
};

const videoAt = (file: string, sizeBytes: number): VideoSource => ({
  sizeBytes,
  sha256: () => sha256Of(file),
  async read(from, to) {
    const handle = await open(file, "r");
    try {
      const buffer = new Uint8Array(to - from);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  },
});

export const folderRender = (folder: string): RenderSource => ({
  async json(name) {
    return JSON.parse(await readFile(path.join(folder, name), "utf8"));
  },
  async video(fileName) {
    const file = path.join(folder, fileName);
    const info = await stat(file).catch(() => null);
    return info === null || !info.isFile() ? null : videoAt(file, info.size);
  },
});

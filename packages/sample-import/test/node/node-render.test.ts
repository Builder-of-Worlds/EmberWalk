import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { folderRender } from "../../src/node-render.ts";

const VIDEO = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
let folder = "";

beforeAll(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "sample-import-"));
  await writeFile(path.join(folder, "render.json"), JSON.stringify({ scene: "yard" }));
  await writeFile(path.join(folder, "motion.json"), "{not json");
  await writeFile(path.join(folder, "walk.mp4"), VIDEO);
  await mkdir(path.join(folder, "folder.mp4"));
});

afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

describe("a render folder on disk", () => {
  it("reads a json file", async () => {
    expect(await folderRender(folder).json("render.json")).toEqual({ scene: "yard" });
  });

  it("fails on json that cannot be parsed and on a file that is not there", async () => {
    await expect(folderRender(folder).json("motion.json")).rejects.toThrow();
    await expect(folderRender(path.join(folder, "nowhere")).json("render.json")).rejects.toThrow();
  });

  it("gives the size and the sha256 of the video", async () => {
    const video = await folderRender(folder).video("walk.mp4");
    expect(video?.sizeBytes).toBe(1000);
    expect(await video?.sha256()).toBe(createHash("sha256").update(VIDEO).digest("hex"));
  });

  it("reads the bytes between two offsets", async () => {
    const video = await folderRender(folder).video("walk.mp4");
    expect(await video?.read(10, 20)).toEqual(VIDEO.slice(10, 20));
    expect(await video?.read(0, 1000)).toEqual(VIDEO);
  });

  it("reads only what is there when the range runs past the end", async () => {
    const video = await folderRender(folder).video("walk.mp4");
    expect(await video?.read(990, 1100)).toEqual(VIDEO.slice(990));
  });

  it("answers null for a video that is missing or is not a file", async () => {
    expect(await folderRender(folder).video("other.mp4")).toBeNull();
    expect(await folderRender(folder).video("folder.mp4")).toBeNull();
  });
});

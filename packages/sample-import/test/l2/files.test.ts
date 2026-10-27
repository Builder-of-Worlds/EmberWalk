import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { hostRender } from "./files.ts";

type RenderFile = { size_bytes: number; sha256: string };

const files = env.RENDER_FILES;
const ask = (path: string) => files.fetch(`http://render/${path}`);

describe("the host folder behind the L2 test", () => {
  it("serves the render, motion and truth files as JSON", async () => {
    for (const name of ["render.json", "motion.json", "truth.json"]) {
      const response = await ask(name);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ synthetic: true, scene: "test-yard-2" });
    }
  });

  it("refuses any other file name", async () => {
    for (const name of ["package.json", "walk.mp4.settings.json", "scene.blend", "..%2Fpackage.json", ""]) {
      expect((await ask(name)).status, name).toBe(404);
    }
  });

  it("reports the video's size and sha256, which render.json names", async () => {
    const render = (await (await ask("render.json")).json()) as RenderFile;
    const video = await hostRender(files).video("walk.mp4");
    expect(video?.sizeBytes).toBe(render.size_bytes);
    expect(await video?.sha256()).toBe(render.sha256);
  });

  it("reads exactly the bytes asked for", async () => {
    const video = await hostRender(files).video("walk.mp4");
    const size = video?.sizeBytes ?? 0;
    const head = await video?.read(0, 100);
    expect(head).toHaveLength(100);
    expect(new TextDecoder().decode(head?.subarray(4, 8))).toBe("ftyp");
    expect(await video?.read(size - 10, size)).toHaveLength(10);
    expect(await video?.read(50, 52)).toEqual(head?.subarray(50, 52));
  });

  it("finds no video that is not in the folder", async () => {
    expect(await hostRender(files).video("walk-2.mp4")).toBeNull();
  });
});

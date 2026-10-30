import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { heroPath, renderFiles } from "../../vitest.l2.ts";

const ask = (handler: (request: Request) => Promise<Response>, name: string) => handler(new Request(`http://render/${name}`));

const folder = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "render-files-"));
  await writeFile(path.join(dir, "render.json"), JSON.stringify({ scene: "from-folder" }));
  return dir;
};

describe("the host folder behind the L2 and hero tests", () => {
  it("serves truth.json from the truth path it is given, and the other files from the folder", async () => {
    const dir = await folder();
    const truth = path.join(dir, "elsewhere.json");
    await writeFile(truth, JSON.stringify({ scene: "from-truth-path" }));
    const handler = renderFiles(dir, truth);
    expect(await (await ask(handler, "truth.json")).json()).toEqual({ scene: "from-truth-path" });
    expect(await (await ask(handler, "render.json")).json()).toEqual({ scene: "from-folder" });
  });

  it("serves the test yard 2 truth when no truth path is given", async () => {
    const handler = renderFiles(await folder());
    expect(await (await ask(handler, "truth.json")).json()).toMatchObject({ scene: "test-yard-2", synthetic: true });
  });

  it("refuses a file name it does not serve, even with a truth path", async () => {
    const dir = await folder();
    const handler = renderFiles(dir, path.join(dir, "render.json"));
    for (const name of ["package.json", "scene.blend", "..%2Frender.json"]) {
      expect((await ask(handler, name)).status, name).toBe(404);
    }
  });
});

describe("heroPath", () => {
  it("takes the named environment variable, else the fallback", () => {
    expect(heroPath("HERO_TEST_UNSET_VARIABLE", "/fallback")).toBe("/fallback");
    process.env["HERO_TEST_SET_VARIABLE"] = "/from-env";
    expect(heroPath("HERO_TEST_SET_VARIABLE", "/fallback")).toBe("/from-env");
    process.env["HERO_TEST_SET_VARIABLE"] = "";
    expect(heroPath("HERO_TEST_SET_VARIABLE", "/fallback")).toBe("/fallback");
    delete process.env["HERO_TEST_SET_VARIABLE"];
  });
});

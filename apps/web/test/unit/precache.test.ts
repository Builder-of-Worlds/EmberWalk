import { describe, expect, it } from "vitest";
import { injectPrecache, precacheFor, precachePlugin, SW_FILE } from "../../build/precache.ts";

describe("precacheFor", () => {
  it("lists every built file and public file except the worker and source maps, sorted", () => {
    const p = precacheFor(["index.html", "sw.js", "assets/a-1.js", "assets/a-1.js.map"], ["icon.svg"]);
    expect(p.files).toEqual(["assets/a-1.js", "icon.svg", "index.html"]);
    expect(p.version).toMatch(/^[0-9a-f]{16}$/);
  });

  it("gives a new version when any file name changes, so a new build replaces the old cache", () => {
    const a = precacheFor(["assets/a-1.js"], []);
    const b = precacheFor(["assets/a-2.js"], []);
    expect(a.version).not.toBe(b.version);
    expect(precacheFor(["assets/a-1.js"], []).version).toBe(a.version);
  });
});

describe("injectPrecache", () => {
  it("puts the list on the worker's global before its code", () => {
    const code = injectPrecache("run();", { version: "v", files: ["a"] });
    const scope: Record<string, unknown> = {};
    new Function("self", code.replace("run();", ""))(scope);
    expect(scope.__EMBERWALK_PRECACHE).toEqual({ version: "v", files: ["a"] });
    expect(code.endsWith("\nrun();")).toBe(true);
  });
});

describe("precachePlugin", () => {
  const generate = (bundle: Record<string, unknown>) => {
    const plugin = precachePlugin(["icon.svg"]);
    const hook = plugin.generateBundle as unknown as (o: unknown, b: Record<string, unknown>) => void;
    hook.call({}, {}, bundle);
  };

  it("writes the list into sw.js", () => {
    const sw = { type: "chunk", code: "run();" };
    generate({ [SW_FILE]: sw, "index.html": { type: "asset", source: "" } });
    expect(sw.code).toContain('"files":["icon.svg","index.html"]');
  });

  it("stops the build when there is no sw.js chunk", () => {
    expect(() => generate({ "index.html": { type: "asset", source: "" } })).toThrow(/no sw\.js/);
    expect(() => generate({ [SW_FILE]: { type: "asset", source: "" } })).toThrow(/no sw\.js/);
  });

  it("runs only for builds", () => {
    expect(precachePlugin([]).apply).toBe("build");
  });
});

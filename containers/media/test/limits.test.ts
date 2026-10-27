import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer } from "./support/fixture-server.ts";
import type { FixtureServer } from "./support/fixture-server.ts";
import { clipWithSound } from "./support/fixtures.ts";
import type { Json } from "./support/media-suite.ts";
import { spawnServer, waitForHealth } from "./support/server-process.ts";

const running: { child?: ChildProcess; fixtures?: FixtureServer } = {};

const boot = async (env: Record<string, string>, port: number): Promise<string> => {
  running.fixtures = await startFixtureServer();
  running.child = spawnServer(port, env);
  const base = `http://127.0.0.1:${port}`;
  await waitForHealth(base);
  return base;
};

const probe = async (base: string, path: string) => {
  const res = await fetch(`${base}/probe`, {
    method: "POST",
    body: JSON.stringify({ input: `http://127.0.0.1:${running.fixtures?.port}${path}` }),
  });
  return { status: res.status, json: (await res.json()) as Json };
};

afterEach(async () => {
  running.child?.kill("SIGKILL");
  await running.fixtures?.close();
});

describe("media server limits set by environment", () => {
  it("refuses an input whose declared size is above the limit", async () => {
    const base = await boot({ MEDIA_MAX_INPUT_BYTES: "1000" }, 18101);
    running.fixtures?.files.set("/big", Buffer.alloc(2000, 1));
    const reply = await probe(base, "/big");
    expect(reply.status).toBe(413);
    expect(reply.json.error.code).toBe("input_too_large");
  });

  it("stops a download that grows past the limit without declaring its size", async () => {
    const base = await boot({ MEDIA_MAX_INPUT_BYTES: "1000" }, 18102);
    running.fixtures?.files.set("/big", Buffer.alloc(2000, 1));
    running.fixtures?.chunked.add("/big");
    const reply = await probe(base, "/big");
    expect(reply.status).toBe(413);
    expect(reply.json.error.code).toBe("input_too_large");
  });

  it("accepts an input exactly at the limit", async () => {
    const clip = clipWithSound(1);
    const base = await boot({ MEDIA_MAX_INPUT_BYTES: String(clip.length) }, 18103);
    running.fixtures?.files.set("/exact.mp4", clip);
    expect((await probe(base, "/exact.mp4")).status).toBe(200);
    running.fixtures?.chunked.add("/exact.mp4");
    expect((await probe(base, "/exact.mp4")).status).toBe(200);
  });

  it("refuses media longer than the allowed length", async () => {
    const base = await boot({ MEDIA_MAX_SECONDS: "5" }, 18104);
    running.fixtures?.files.set("/long.mp4", clipWithSound(10));
    const reply = await probe(base, "/long.mp4");
    expect(reply.status).toBe(422);
    expect(reply.json.error.code).toBe("media_too_long");
  });

  it("refuses a frame rate above a lowered limit", async () => {
    const base = await boot({ MEDIA_MAX_FPS: "1" }, 18105);
    const res = await fetch(`${base}/clip`, {
      method: "POST",
      body: JSON.stringify({ input: "http://127.0.0.1:1/x", output: "http://127.0.0.1:1/y", fps: 2 }),
    });
    expect(((await res.json()) as Json).error.code).toBe("fps_too_high");
  });

  it("falls back to the defaults when a limit is not a positive number", async () => {
    const base = await boot({ MEDIA_MAX_FPS: "abc" }, 18106);
    const res = await fetch(`${base}/clip`, {
      method: "POST",
      body: JSON.stringify({ input: "http://127.0.0.1:1/x", output: "http://127.0.0.1:1/y", fps: 5 }),
    });
    expect(((await res.json()) as Json).error.code).toBe("fps_too_high");
  });

  it("falls back to the defaults when a limit is zero", async () => {
    const base = await boot({ MEDIA_MAX_FPS: "0" }, 18107);
    const res = await fetch(`${base}/clip`, {
      method: "POST",
      body: JSON.stringify({ input: "http://127.0.0.1:1/x", output: "http://127.0.0.1:1/y", fps: 4 }),
    });
    expect(((await res.json()) as Json).error.code).toBe("input_unavailable");
  });
});

import type { ChildProcess } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFixtureServer } from "./support/fixture-server.ts";
import type { FixtureServer } from "./support/fixture-server.ts";
import { clipWithoutSound } from "./support/fixtures.ts";
import type { Json } from "./support/media-suite.ts";
import { freePort, spawnServer, waitForHealth, waitForIdle } from "./support/server-process.ts";

const OLD_DEFAULT_LIMIT_MS = 5_000;

type Reply = { status: number; json: Json };

describe("media tests on a loaded machine", () => {
  let child: ChildProcess;
  let fixtures: FixtureServer;
  let base: string;
  let left: Promise<Reply> | undefined;

  const probe = async (): Promise<Reply> => {
    const res = await fetch(`${base}/probe`, {
      method: "POST",
      body: JSON.stringify({ input: `http://127.0.0.1:${fixtures.port}/silent.mp4` }),
    });
    return { status: res.status, json: (await res.json()) as Json };
  };

  const health = async (): Promise<Json> => (await (await fetch(`${base}/health`)).json()) as Json;

  beforeAll(async () => {
    fixtures = await startFixtureServer();
    fixtures.files.set("/silent.mp4", clipWithoutSound(2));
    const port = await freePort();
    child = spawnServer(port);
    base = `http://127.0.0.1:${port}`;
    await waitForHealth(base);
  });

  beforeEach(async () => {
    await waitForIdle(base);
  });

  afterAll(async () => {
    child?.kill("SIGKILL");
    await left?.catch(() => undefined);
    await fixtures?.close();
  });

  it("counts its running jobs in its health signal", async () => {
    const release = fixtures.hold("/silent.mp4");
    const fetching = fixtures.requested("/silent.mp4");
    const job = probe();
    try {
      await fetching;
      expect((await health()).jobs).toBe(1);
    } finally {
      release();
    }
    expect((await job).status).toBe(200);
    expect((await health()).jobs).toBe(0);
  });

  it("lets a job slower than the old 5 second default finish inside the test time limit", async () => {
    const release = fixtures.hold("/silent.mp4");
    const fetching = fixtures.requested("/silent.mp4");
    const job = probe();
    await fetching;
    setTimeout(release, OLD_DEFAULT_LIMIT_MS + 500);
    expect((await job).status).toBe(200);
  });

  it("leaves a job running, as a test cut off by its time limit does", async () => {
    const release = fixtures.hold("/silent.mp4");
    const fetching = fixtures.requested("/silent.mp4");
    left = probe();
    await fetching;
    setTimeout(release, 1_500);
    expect((await health()).jobs).toBe(1);
  });

  it("starts the next test only once that job is done, so it is never refused as busy", async () => {
    const reply = await probe();
    expect(reply.status).toBe(200);
    expect((await left)?.status).toBe(200);
  });
});

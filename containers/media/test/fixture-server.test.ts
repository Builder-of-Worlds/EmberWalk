import { afterEach, describe, expect, it } from "vitest";
import { startFixtureServer } from "./support/fixture-server.ts";
import type { FixtureServer } from "./support/fixture-server.ts";

let fixtures: FixtureServer | undefined;

afterEach(async () => {
  await fixtures?.close();
  fixtures = undefined;
});

const pending = async (promise: Promise<void>): Promise<boolean> => {
  const settled = await Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 50))]);
  return !settled;
};

describe("the fixture server's request signal", () => {
  it("stays pending until the named path is requested, then resolves", async () => {
    fixtures = await startFixtureServer();
    fixtures.files.set("/a.mp4", Buffer.from("a"));
    const arrived = fixtures.requested("/a.mp4");

    expect(await pending(arrived)).toBe(true);
    await fetch(`http://127.0.0.1:${fixtures.port}/a.mp4`);
    await expect(arrived).resolves.toBeUndefined();
  });

  it("resolves while the response is still held back by a delay", async () => {
    fixtures = await startFixtureServer();
    fixtures.files.set("/slow.mp4", Buffer.from("s"));
    fixtures.delays.set("/slow.mp4", 300);
    const arrived = fixtures.requested("/slow.mp4");
    const response = fetch(`http://127.0.0.1:${fixtures.port}/slow.mp4`);

    await expect(arrived).resolves.toBeUndefined();
    fixtures.delays.delete("/slow.mp4");
    await response;
  });

  it("ignores a request for another path", async () => {
    fixtures = await startFixtureServer();
    fixtures.files.set("/other.mp4", Buffer.from("o"));
    const arrived = fixtures.requested("/a.mp4");
    await fetch(`http://127.0.0.1:${fixtures.port}/other.mp4`);

    expect(await pending(arrived)).toBe(true);
  });
});

describe("the fixture server's hold", () => {
  const settledWithin = async (response: Promise<unknown>, ms: number): Promise<boolean> =>
    Promise.race([response.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))]);

  it("keeps the response back for as long as the hold stands, then sends the file when released", async () => {
    fixtures = await startFixtureServer();
    fixtures.files.set("/held.mp4", Buffer.from("held"));
    const release = fixtures.hold("/held.mp4");
    const arrived = fixtures.requested("/held.mp4");
    const response = fetch(`http://127.0.0.1:${fixtures.port}/held.mp4`);

    await expect(arrived).resolves.toBeUndefined();
    expect(await settledWithin(response, 400)).toBe(false);
    release();
    expect(Buffer.from(await (await response).arrayBuffer()).toString()).toBe("held");
  });

  it("answers at once for a path that was not held, and for a request made after the release", async () => {
    fixtures = await startFixtureServer();
    fixtures.files.set("/held.mp4", Buffer.from("h"));
    fixtures.files.set("/free.mp4", Buffer.from("f"));
    const release = fixtures.hold("/held.mp4");

    expect(await settledWithin(fetch(`http://127.0.0.1:${fixtures.port}/free.mp4`), 400)).toBe(true);
    release();
    expect(await settledWithin(fetch(`http://127.0.0.1:${fixtures.port}/held.mp4`), 400)).toBe(true);
  });

  it("lets a second release do nothing", async () => {
    fixtures = await startFixtureServer();
    fixtures.files.set("/held.mp4", Buffer.from("h"));
    const release = fixtures.hold("/held.mp4");
    release();
    release();

    expect(await settledWithin(fetch(`http://127.0.0.1:${fixtures.port}/held.mp4`), 400)).toBe(true);
  });
});

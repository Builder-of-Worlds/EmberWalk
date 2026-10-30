import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Container } from "@cloudflare/containers";
import { describe, expect, it } from "vitest";
import { depsFrom } from "../src/deps.ts";
import type { Env } from "../src/env.ts";
import * as entry from "../src/index.ts";
import { MEDIA_INSTANCES, MEDIA_PORT, MediaContainer, mediaFetcher } from "../src/media-container.ts";
import { type MediaStandIn, STAND_IN_PROBE } from "./media-stand-in.ts";

const built = (container: unknown): Promise<MediaContainer> => {
  const binding = (env as unknown as { MEDIA_CONTAINER: DurableObjectNamespace<MediaStandIn> }).MEDIA_CONTAINER;
  return runInDurableObject(binding.get(binding.idFromName(crypto.randomUUID())), (_instance, state) => {
    Object.defineProperty(state, "container", { value: container, configurable: true });
    return new MediaContainer(state as DurableObjectState<Record<string, never>>, env);
  });
};

const namespace = () => {
  const names: string[] = [];
  const binding = {
    idFromName: (name: string) => {
      names.push(name);
      return name;
    },
    get: (id: string) => ({ fetch: async () => new Response(id) }),
  } as unknown as DurableObjectNamespace<MediaContainer>;
  return { binding, names };
};

describe("the media Container class", () => {
  it("is exported by the pipeline Worker and listens on port 8080", async () => {
    expect(entry.MediaContainer).toBe(MediaContainer);
    expect(MediaContainer.prototype).toBeInstanceOf(Container);
    const made = await built({ running: false });
    expect(MEDIA_PORT).toBe(8080);
    expect(made.defaultPort).toBe(8080);
    expect(made.sleepAfter).toBe("5m");
  });

  it("refuses to start where the runtime gives it no container", async () => {
    await expect(built(undefined)).rejects.toThrow(/Containers have not been enabled/);
  });
});

describe("mediaFetcher", () => {
  it("spreads calls over the named instances and never past the last one", async () => {
    const { binding, names } = namespace();
    for (const pick of [0, 0.34, 0.67, 0.999999, 1]) {
      const answer = await mediaFetcher(binding, () => pick).fetch("http://media/probe", { method: "POST" });
      expect(await answer.text()).toBe(names.at(-1));
    }
    expect(names).toEqual(["media-0", "media-1", "media-2", "media-2", "media-2"]);
    expect(MEDIA_INSTANCES).toBe(3);
  });
});

describe("depsFrom reaches the media Container through MEDIA_CONTAINER", () => {
  const media = () => depsFrom(env as unknown as Env).media;

  it("reads the probe the binding answers", async () => {
    expect(await media().probe("https://r2.test/walk.mp4")).toEqual({ ok: true, value: STAND_IN_PROBE });
  });

  it("turns a refusal from the binding into a refusal", async () => {
    expect(await media().probe("refuse")).toEqual({ ok: false, failure: { code: "media_not_a_video", message: "That file is not a video." } });
  });

  it("throws on a server error so the step retries", async () => {
    await expect(media().probe("break")).rejects.toThrow("500");
  });
});

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mediaSuite } from "../test/support/media-suite.ts";
import type { Target } from "../test/support/media-suite.ts";
import { waitForHealth } from "../test/support/server-process.ts";
import { timeLimits } from "../test/support/time-limits.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const image = "emberwalk-media:test";
const leftoverLabel = "emberwalk.test=media-image";

const docker = (args: string[], timeout = timeLimits.imageBuildMs): string => {
  const run = spawnSync("docker", args, { encoding: "utf8", timeout });
  if (run.status !== 0) {
    throw new Error(`docker ${args[0]} failed: ${run.stderr || run.error?.message}`);
  }
  return run.stdout.trim();
};

mediaSuite("media container image", async (): Promise<Target> => {
  docker(["build", "--tag", image, root]);
  const id = docker([
    "run", "--detach", "--rm", "--stop-timeout", "1", "--label", leftoverLabel, "--memory", "4g",
    "--publish", "127.0.0.1::8080",
    "--add-host", "host.docker.internal:host-gateway",
    image,
  ]);
  const mapping = docker(["port", id, "8080/tcp"]).split("\n")[0] ?? "";
  const baseUrl = `http://127.0.0.1:${mapping.split(":").pop()}`;
  try {
    await waitForHealth(baseUrl);
  } catch (error) {
    spawnSync("docker", ["rm", "--force", id]);
    throw error;
  }
  return {
    baseUrl,
    fixtureHost: "host.docker.internal",
    stop: async () => {
      spawnSync("docker", ["rm", "--force", id]);
    },
  };
});

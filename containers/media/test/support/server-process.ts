import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { timeLimits } from "./time-limits.ts";

export const serverEntry = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "server.ts");

export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => {
      const port = (probe.address() as { port: number }).port;
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });

export const spawnServer = (port: number, env: Record<string, string> = {}): ChildProcess =>
  spawn("node", [serverEntry], {
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });

const pollHealth = async (baseUrl: string, ready: (health: { jobs?: number }) => boolean): Promise<boolean> => {
  const until = Date.now() + timeLimits.readyMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok && ready((await res.json()) as { jobs?: number })) return true;
    } catch {
      // the server is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, timeLimits.pollMs));
  }
  return false;
};

export const waitForHealth = async (baseUrl: string, label = "the media server"): Promise<void> => {
  if (!(await pollHealth(baseUrl, () => true))) throw new Error(`${label} never became healthy`);
};

export const waitForIdle = async (baseUrl: string): Promise<void> => {
  if (!(await pollHealth(baseUrl, (health) => health.jobs === 0))) throw new Error("the media server never became idle");
};

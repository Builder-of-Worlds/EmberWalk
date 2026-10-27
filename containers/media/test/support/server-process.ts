import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

export const waitForHealth = async (baseUrl: string, label = "the media server"): Promise<void> => {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${baseUrl}/health`)).ok) return;
    } catch {
      // the server is still starting
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${label} never became healthy`);
};

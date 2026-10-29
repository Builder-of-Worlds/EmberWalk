import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { freePort, serverEntry, waitForHealth } from "./support/server-process.ts";

const helper = join(dirname(fileURLToPath(import.meta.url)), "support", "orphan-helper.ts");

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const pidFrom = (child: ReturnType<typeof spawn>): Promise<number> =>
  new Promise((resolve, reject) => {
    let text = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
      if (text.includes("\n")) resolve(Number(text.trim()));
    });
    child.on("exit", () => reject(new Error("the helper ended before it printed the server pid")));
  });

describe("media server when its parent dies", () => {
  it("exits within 2 seconds after the parent is killed without cleanup", async () => {
    const parent = spawn("node", [helper], { stdio: ["ignore", "pipe", "inherit"] });
    const serverPid = await pidFrom(parent);
    expect(alive(serverPid)).toBe(true);

    parent.kill("SIGKILL");
    const deadline = Date.now() + 2000;
    while (alive(serverPid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const survived = alive(serverPid);
    if (survived) process.kill(serverPid, "SIGKILL");
    expect(survived).toBe(false);
  });

  it("keeps running when it was started without a parent channel, as in the container", async () => {
    const port = await freePort();
    const server = spawn("node", [serverEntry], {
      env: { ...process.env, PORT: String(port) },
      stdio: ["ignore", "inherit", "inherit"],
    });
    try {
      await waitForHealth(`http://127.0.0.1:${port}`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect((await fetch(`http://127.0.0.1:${port}/health`)).ok).toBe(true);
    } finally {
      server.kill("SIGKILL");
    }
  });
});

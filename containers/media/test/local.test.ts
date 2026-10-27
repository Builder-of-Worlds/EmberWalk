import { mediaSuite } from "./support/media-suite.ts";
import type { Target } from "./support/media-suite.ts";
import { freePort, spawnServer, waitForHealth } from "./support/server-process.ts";

mediaSuite("media server on the host", async (): Promise<Target> => {
  const port = await freePort();
  const child = spawnServer(port);
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForHealth(baseUrl);
  return {
    baseUrl,
    fixtureHost: "127.0.0.1",
    stop: async () => {
      child.kill("SIGKILL");
    },
  };
});

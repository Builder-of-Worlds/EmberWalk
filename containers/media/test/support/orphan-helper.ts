import { freePort, spawnServer, waitForHealth } from "./server-process.ts";

const port = await freePort();
const child = spawnServer(port);
await waitForHealth(`http://127.0.0.1:${port}`);
process.stdout.write(`${child.pid}\n`);
setInterval(() => undefined, 1000);

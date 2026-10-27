import { run } from "./cli.ts";
import { folderRender } from "./node-render.ts";

process.exitCode = await run(process.argv.slice(2), { fetch: (request) => fetch(request), render: folderRender, log: console.log });

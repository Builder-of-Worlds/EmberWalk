import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";

const FILES = new Set(["render.json", "motion.json", "walk.mp4", "truth.json"]);
const TRUTH = fileURLToPath(new URL("../../fixtures/synthetic/test-yard-2/truth.json", import.meta.url));

const sha256Of = async (file: string): Promise<string> => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
};

const renderFiles = (folder: string) => async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const name = url.pathname.slice(1);
  if (!FILES.has(name)) return new Response("no such file", { status: 404 });
  const file = name === "truth.json" ? TRUTH : path.join(folder, name);
  const info = await stat(file);
  const op = url.searchParams.get("op");
  if (op === "size") return Response.json({ size: info.size });
  if (op === "sha256") return Response.json({ sha256: await sha256Of(file) });
  if (op === "read") {
    const from = Number(url.searchParams.get("from"));
    const to = Number(url.searchParams.get("to"));
    const handle = await open(file, "r");
    try {
      const buffer = new Uint8Array(to - from);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, from);
      return new Response(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }
  return new Response(await readFile(file, "utf8"), { headers: { "content-type": "application/json" } });
};

export const l2Project = async (name: string, renderFolder: string) => {
  const migrations = await readD1Migrations(fileURLToPath(new URL("../../migrations", import.meta.url)));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "../../workers/pipeline/test/wrangler.test.jsonc" },
        miniflare: {
          serviceBindings: { RENDER_FILES: renderFiles(renderFolder) },
          bindings: {
            TEST_MIGRATIONS: migrations,
            R2_ACCESS_KEY_ID: "test-key-id",
            R2_SECRET_ACCESS_KEY: "test-secret",
          },
        },
      }),
    ],
    test: {
      name,
      include: ["test/l2/**/*.test.ts"],
      setupFiles: ["../../workers/pipeline/test/apply-migrations.ts"],
      testTimeout: 120_000,
    },
  };
};

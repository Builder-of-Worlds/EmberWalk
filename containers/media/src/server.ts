import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { MediaError, badRequest } from "./errors.ts";
import { version } from "./ffmpeg.ts";
import { limits } from "./limits.ts";
import { audioOp, clipOp, probeOp, stillsOp } from "./ops.ts";
import { parseAudio, parseClip, parseProbe, parseStills } from "./validate.ts";

const routes: Record<string, (body: unknown) => Promise<unknown>> = {
  "/probe": (body) => probeOp(parseProbe(body)),
  "/clip": (body) => clipOp(parseClip(body)),
  "/audio": (body) => audioOp(parseAudio(body)),
  "/stills": (body) => stillsOp(parseStills(body)),
};

const send = (res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}): void => {
  const text = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), ...headers });
  res.end(text);
};

const readJson = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limits.maxBodyBytes) throw new MediaError(413, "body_too_large", "The request body is too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw badRequest("invalid_json", "The request body is not valid JSON.");
  }
};

let active = 0;

const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const path = new URL(req.url ?? "/", "http://container").pathname;
  if (path === "/health") {
    if (req.method !== "GET") throw new MediaError(405, "method_not_allowed", "Use GET.");
    send(res, 200, { status: "ok", ffmpeg: await version() });
    return;
  }
  const route = routes[path];
  if (route === undefined) throw new MediaError(404, "not_found", "No such operation.");
  if (req.method !== "POST") throw new MediaError(405, "method_not_allowed", "Use POST.");
  const body = await readJson(req);
  if (active >= limits.maxConcurrent) {
    send(res, 503, { error: { code: "busy", message: "The media container is busy. Try again shortly." } }, { "retry-after": "5" });
    return;
  }
  active += 1;
  try {
    send(res, 200, await route(body));
  } finally {
    active -= 1;
  }
};

const server = createServer((req, res) => {
  handle(req, res).catch((error: unknown) => {
    if (res.headersSent) return;
    if (error instanceof MediaError) {
      send(res, error.status, { error: { code: error.code, message: error.message } });
      return;
    }
    send(res, 500, { error: { code: "internal", message: "The media container failed." } });
  });
});

server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0");

if (process.send !== undefined) {
  if (!process.connected) process.exit(0);
  process.on("disconnect", () => process.exit(0));
}

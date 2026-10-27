import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MediaError } from "./errors.ts";
import { limits } from "./limits.ts";

export const download = async (url: string, path: string): Promise<number> => {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(limits.transferTimeoutMs) });
  } catch {
    throw new MediaError(502, "input_unavailable", "The input could not be fetched.");
  }
  if (!response.ok || response.body === null) {
    throw new MediaError(502, "input_unavailable", `The input could not be fetched (status ${response.status}).`);
  }
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > limits.maxInputBytes) {
    throw new MediaError(413, "input_too_large", "The input is larger than the allowed size.");
  }
  let seen = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > limits.maxInputBytes) {
        done(new MediaError(413, "input_too_large", "The input is larger than the allowed size."));
        return;
      }
      done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), counter, createWriteStream(path));
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError(502, "input_unavailable", "The input download was interrupted.");
  }
  return seen;
};

export const upload = async (url: string, path: string, contentType: string): Promise<number> => {
  const body = await readFile(path);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      body,
      headers: { "content-type": contentType, "content-length": String(body.length) },
      signal: AbortSignal.timeout(limits.transferTimeoutMs),
    });
  } catch {
    throw new MediaError(502, "output_failed", "The result could not be stored.");
  }
  if (!response.ok) {
    throw new MediaError(502, "output_failed", `The result could not be stored (status ${response.status}).`);
  }
  return body.length;
};

import { env, exports } from "cloudflare:workers";
import { DEFAULT_LIMITS } from "@emberwalk/shared";
import { s3StandIn } from "./s3-standin.ts";

export const MiB = 1024 * 1024;
export const PART_BYTES = DEFAULT_LIMITS.uploadPartBytes;

export type Reply = {
  status: number;
  json: {
    error: { code: string; message: string };
    uploadId: string;
    partBytes: number;
    partCount: number;
    expiresAt: string;
    url: string;
    method: string;
    headers: Record<string, string>;
    walkId: string;
    bytes: number;
  };
};

export const call = async (path: string, body: unknown, method = "POST"): Promise<Reply> => {
  const response = await exports.default.fetch(
    new Request(`https://api.test${path}`, {
      method,
      headers: { "content-type": "application/json" },
      ...(method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
    }),
  );
  return { status: response.status, json: (await response.json()) as Reply["json"] };
};

export const start = (walkId: string, totalBytes: number) => call("/api/uploads", { walkId, totalBytes });
export const link = (uploadId: string, partNumber: number) => call("/api/uploads/part", { uploadId, partNumber });
export const complete = (uploadId: string, parts: { partNumber: number; etag: string }[]) =>
  call("/api/uploads/complete", { uploadId, parts });
export const abort = (uploadId: string) => call("/api/uploads/abort", { uploadId });

export const mp4Bytes = (size: number, fill: number): Uint8Array => {
  const bytes = new Uint8Array(size).fill(fill);
  bytes.set([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 0);
  return bytes;
};

export const putPart = (signed: Reply["json"], bytes: Uint8Array, at: Date = new Date()) =>
  s3StandIn(new Request(signed.url, { method: "PUT", headers: signed.headers, body: bytes }), {
    bucket: env.MEDIA,
    bucketName: env.R2_BUCKET_NAME,
    host: env.R2_HOST,
    accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
    now: () => at,
  });

export const uploadAll = async (
  uploadId: string,
  total: number,
  firstPart: (size: number, n: number) => Uint8Array = mp4Bytes,
): Promise<{ partNumber: number; etag: string }[]> => {
  const parts: { partNumber: number; etag: string }[] = [];
  const count = Math.ceil(total / PART_BYTES);
  for (let n = 1; n <= count; n += 1) {
    const size = n === count ? total - (count - 1) * PART_BYTES : PART_BYTES;
    const signed = (await link(uploadId, n)).json;
    const res = await putPart(signed, n === 1 ? firstPart(size, n) : new Uint8Array(size).fill(n));
    if (res.status !== 200) throw new Error(`part ${n} was refused with ${res.status}`);
    parts.push({ partNumber: n, etag: (res.headers.get("etag") ?? "").replaceAll('"', "") });
  }
  return parts;
};

export const emptyBucket = async (): Promise<void> => {
  let cursor: string | undefined;
  do {
    const page = await env.MEDIA.list(cursor === undefined ? {} : { cursor });
    await Promise.all(page.objects.map((o) => env.MEDIA.delete(o.key)));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor !== undefined);
};

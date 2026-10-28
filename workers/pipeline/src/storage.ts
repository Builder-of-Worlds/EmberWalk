import { ClipKind } from "@emberwalk/shared";
import { presign } from "@emberwalk/sigv4";
import type { Env } from "./env.ts";

export const originalKey = (walkId: string): string => `originals/${walkId}/walk.mp4`;
export const soundKey = (walkId: string): string => `originals/${walkId}/sound.wav`;
export const turnsKey = (walkId: string): string => `originals/${walkId}/turns.json`;
export const clipKey = (walkId: string, kind: string): string => `clips/${walkId}/${kind}.mp4`;
export const detectionsKey = (walkId: string, clipId: string): string => `clips/${walkId}/${clipId}/detections.json`;
export const lookKey = (walkId: string, clipId: string, n: number): string => `clips/${walkId}/${clipId}/look/${n}.jpg`;
export const maskKey =(walkId: string, clipId: string, trackId: string): string => `clips/${walkId}/${clipId}/masks/${trackId}.json`;

export const dropWalkVideo = async (bucket: R2Bucket, walkId: string): Promise<void> => {
  await bucket.delete([originalKey(walkId), soundKey(walkId), turnsKey(walkId), ...ClipKind.options.map((kind) => clipKey(walkId, kind))]);
};

export type Signer = {
  get(key: string): Promise<string>;
  put(key: string): Promise<string>;
};

const LINK_SECONDS = 3600;

export const r2Signer = (env: Env, now: () => Date = () => new Date()): Signer => {
  const { R2_HOST, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env;
  const sign = (method: "GET" | "PUT", key: string): Promise<string> => {
    if (!R2_HOST || !R2_BUCKET_NAME || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
      throw new Error("storage links are not set up on this server");
    }
    return presign({
      method,
      host: R2_HOST,
      path: `/${R2_BUCKET_NAME}/${key}`,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      region: "auto",
      service: "s3",
      now: now(),
      expiresSeconds: LINK_SECONDS,
    });
  };
  return { get: async (key) => sign("GET", key), put: async (key) => sign("PUT", key) };
};

import type { UploadRecord } from "./upload-rules.ts";

export type UploadStore = {
  get(uploadId: string): Promise<UploadRecord | null>;
  put(record: UploadRecord): Promise<void>;
  openFor(walkId: string): Promise<UploadRecord | null>;
};

export const recordKey = (uploadId: string): string => `uploads/${encodeURIComponent(uploadId)}.json`;
const MAX_KEY_BYTES = 1024;
export const walkKey = (walkId: string): string => `uploads/by-walk/${walkId}.json`;

export const walkUploadsPrefix = (walkId: string): string => `uploads/by-walk/${walkId}/`;

const markerKey = async (walkId: string, uploadId: string): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(uploadId)));
  return `${walkUploadsPrefix(walkId)}${[...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};
export const r2UploadStore = (bucket: R2Bucket): UploadStore => {
  const get = async (uploadId: string): Promise<UploadRecord | null> => {
    const key = recordKey(uploadId);
    if (new TextEncoder().encode(key).length > MAX_KEY_BYTES) return null;
    const object = await bucket.get(key);
    return object === null ? null : ((await object.json()) as UploadRecord);
  };
  return {
    get,
    async put(record) {
      await bucket.put(await markerKey(record.walkId, record.uploadId), record.uploadId);
      await bucket.put(recordKey(record.uploadId), JSON.stringify(record));
      await bucket.put(walkKey(record.walkId), JSON.stringify({ uploadId: record.uploadId }));
    },
    async openFor(walkId) {
      const pointer = await bucket.get(walkKey(walkId));
      if (pointer === null) return null;
      const { uploadId } = (await pointer.json()) as { uploadId: string };
      const record = await get(uploadId);
      return record !== null && record.status === "uploading" ? record : null;
    },
  };
};

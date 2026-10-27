export type UploadLimits = {
  maxBytes: number;
  partBytes: number;
  minPartBytes: number;
  maxParts: number;
  linkTtlSeconds: number;
  sessionTtlSeconds: number;
  maxTriesPerPart: number;
};

export type UploadStatus = "uploading" | "completed" | "aborted";

export type UploadRecord = {
  walkId: string;
  uploadId: string;
  key: string;
  status: UploadStatus;
  totalBytes: number;
  partBytes: number;
  partCount: number;
  createdAt: number;
  expiresAt: number;
  tries: Record<number, number>;
};

export type Refusal =
  | "invalid_size"
  | "too_large"
  | "too_many_parts"
  | "invalid_part_number"
  | "too_many_tries"
  | "upload_expired"
  | "upload_completed"
  | "upload_aborted";

export type Result<T> = { value: T; refusal?: undefined } | { value?: undefined; refusal: Refusal };

const ok = <T>(value: T): Result<T> => ({ value });
const refuse = (refusal: Refusal): Result<never> => ({ refusal });

export const planUpload = (
  totalBytes: unknown,
  limits: UploadLimits,
): Result<{ partBytes: number; partCount: number }> => {
  if (typeof totalBytes !== "number" || !Number.isInteger(totalBytes) || totalBytes <= 0) return refuse("invalid_size");
  if (totalBytes > limits.maxBytes) return refuse("too_large");
  const partCount = Math.ceil(totalBytes / limits.partBytes);
  if (partCount > limits.maxParts) return refuse("too_many_parts");
  return ok({ partBytes: limits.partBytes, partCount });
};

export const partSize = (record: UploadRecord, partNumber: number): number =>
  partNumber === record.partCount ? record.totalBytes - (record.partCount - 1) * record.partBytes : record.partBytes;

export const checkOpen = (record: UploadRecord, now: number): Result<true> => {
  if (record.status === "completed") return refuse("upload_completed");
  if (record.status === "aborted") return refuse("upload_aborted");
  if (now >= record.expiresAt) return refuse("upload_expired");
  return ok(true);
};

export const nextTry = (
  record: UploadRecord,
  partNumber: unknown,
  now: number,
  limits: UploadLimits,
): Result<{ record: UploadRecord; partNumber: number; size: number }> => {
  const open = checkOpen(record, now);
  if (open.refusal !== undefined) return open;
  if (typeof partNumber !== "number" || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > record.partCount) {
    return refuse("invalid_part_number");
  }
  const used = record.tries[partNumber] ?? 0;
  if (used >= limits.maxTriesPerPart) return refuse("too_many_tries");
  return ok({
    record: { ...record, tries: { ...record.tries, [partNumber]: used + 1 } },
    partNumber,
    size: partSize(record, partNumber),
  });
};

export const checkParts = (
  record: UploadRecord,
  parts: { partNumber: number; etag: string }[],
): Result<{ partNumber: number; etag: string }[]> => {
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  if (sorted.length !== record.partCount) return refuse("invalid_part_number");
  for (const [i, part] of sorted.entries()) {
    if (part.partNumber !== i + 1) return refuse("invalid_part_number");
  }
  return ok(sorted);
};

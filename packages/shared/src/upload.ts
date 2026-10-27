import { z } from "zod";
import { Id, Timestamp } from "./common.ts";

const MAX_PART_NUMBER = 10_000;

export const UploadId = z.string().regex(/^[A-Za-z0-9._~+/=-]{1,1024}$/);
export const PartNumber = z.int().min(1).max(MAX_PART_NUMBER);

export const StartUploadRequest = z.strictObject({ walkId: Id, totalBytes: z.int().positive() });

export const StartUploadResponse = z.strictObject({
  uploadId: UploadId,
  partBytes: z.int().positive(),
  partCount: PartNumber,
  expiresAt: Timestamp,
});

export const PartLinkRequest = z.strictObject({ uploadId: UploadId, partNumber: PartNumber });

export const PartLinkResponse = z.strictObject({
  url: z.url({ protocol: /^https?$/ }),
  method: z.literal("PUT"),
  headers: z.strictObject({ "content-length": z.string().regex(/^[1-9]\d{0,11}$/) }),
  expiresAt: Timestamp,
});

export const CompletedPart = z.strictObject({ partNumber: PartNumber, etag: z.string().min(1).max(200) });

export const CompleteUploadRequest = z
  .strictObject({ uploadId: UploadId, parts: z.array(CompletedPart).min(1).max(MAX_PART_NUMBER) })
  .refine((r) => new Set(r.parts.map((p) => p.partNumber)).size === r.parts.length, {
    message: "each part number may appear once",
    path: ["parts"],
  });

export const AbortUploadRequest = z.strictObject({ uploadId: UploadId });

export const UPLOAD_REFUSALS = [
  "invalid_size",
  "too_large",
  "too_many_parts",
  "invalid_part_number",
  "too_many_tries",
  "upload_expired",
  "upload_completed",
  "upload_aborted",
  "unknown_upload",
  "walk_not_uploading",
  "parts_invalid",
] as const;

export type UploadId = z.infer<typeof UploadId>;
export type StartUploadRequest = z.infer<typeof StartUploadRequest>;
export type StartUploadResponse = z.infer<typeof StartUploadResponse>;
export type PartLinkRequest = z.infer<typeof PartLinkRequest>;
export type PartLinkResponse = z.infer<typeof PartLinkResponse>;
export type CompletedPart = z.infer<typeof CompletedPart>;
export type CompleteUploadRequest = z.infer<typeof CompleteUploadRequest>;
export type AbortUploadRequest = z.infer<typeof AbortUploadRequest>;

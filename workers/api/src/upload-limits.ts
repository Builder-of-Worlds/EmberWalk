import { maxWalkBytes, uploadMaxParts } from "@emberwalk/shared";
import type { Limits } from "@emberwalk/shared";
import type { UploadLimits } from "./upload-rules.ts";

export const uploadLimits = (limits: Limits): UploadLimits => ({
  maxBytes: maxWalkBytes(limits),
  partBytes: limits.uploadPartBytes,
  minPartBytes: limits.uploadMinPartBytes,
  maxParts: uploadMaxParts(limits),
  linkTtlSeconds: limits.uploadLinkTtlSeconds,
  sessionTtlSeconds: limits.uploadSessionTtlSeconds,
  maxTriesPerPart: limits.uploadMaxTriesPerPart,
});

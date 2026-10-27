import { DEFAULT_LIMITS, limitsWith, maxWalkBytes, uploadMaxParts } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import { uploadLimits } from "../src/upload-limits.ts";

describe("upload limits from the shared limits", () => {
  it("maps every shared field the upload rules use", () => {
    expect(uploadLimits(DEFAULT_LIMITS)).toEqual({
      maxBytes: maxWalkBytes(DEFAULT_LIMITS),
      partBytes: DEFAULT_LIMITS.uploadPartBytes,
      minPartBytes: DEFAULT_LIMITS.uploadMinPartBytes,
      maxParts: uploadMaxParts(DEFAULT_LIMITS),
      linkTtlSeconds: DEFAULT_LIMITS.uploadLinkTtlSeconds,
      sessionTtlSeconds: DEFAULT_LIMITS.uploadSessionTtlSeconds,
      maxTriesPerPart: DEFAULT_LIMITS.uploadMaxTriesPerPart,
    });
  });

  it("follows an override", () => {
    const mapped = uploadLimits(limitsWith({ uploadMaxTriesPerPart: 5, uploadLinkTtlSeconds: 60, maxWalkSeconds: 60 }));
    expect(mapped.maxTriesPerPart).toBe(5);
    expect(mapped.linkTtlSeconds).toBe(60);
    expect(mapped.maxBytes).toBe(Math.ceil((60 * DEFAULT_LIMITS.maxVideoBitsPerSecond) / 8));
  });
});

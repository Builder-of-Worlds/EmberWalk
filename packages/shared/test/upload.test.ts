import { describe, expect, it } from "vitest";
import {
  AbortUploadRequest,
  CompleteUploadRequest,
  ErrorBody,
  PartLinkRequest,
  PartLinkResponse,
  StartUploadRequest,
  StartUploadResponse,
  UPLOAD_REFUSALS,
} from "../src/index.ts";
import { AT, id, refusesEach, refusesMissingAndExtra, roundTrips } from "./check.ts";

const UPLOAD = "2~AbC.dEf_gh-ij+kl/mn=";

describe("upload contracts", () => {
  it("round trips the start request and response", () => {
    const req = { walkId: id(1), totalBytes: 25 * 1024 * 1024 };
    roundTrips(StartUploadRequest, req);
    refusesMissingAndExtra(StartUploadRequest, req);
    refusesEach(StartUploadRequest, req, [{ totalBytes: 0 }, { totalBytes: 1.5 }, { totalBytes: "25" }, { walkId: "w1" }]);

    const res = { uploadId: UPLOAD, partBytes: 10 * 1024 * 1024, partCount: 3, expiresAt: AT };
    roundTrips(StartUploadResponse, res);
    refusesMissingAndExtra(StartUploadResponse, res);
    refusesEach(StartUploadResponse, res, [{ partCount: 0 }, { partCount: 10_001 }, { uploadId: "" }, { uploadId: "a b" }]);
    roundTrips(StartUploadResponse, { ...res, partCount: 10_000 });
  });

  it("round trips the part link request and response", () => {
    const req = { uploadId: UPLOAD, partNumber: 1 };
    roundTrips(PartLinkRequest, req);
    roundTrips(PartLinkRequest, { ...req, partNumber: 10_000 });
    refusesMissingAndExtra(PartLinkRequest, req);
    refusesEach(PartLinkRequest, req, [{ partNumber: 0 }, { partNumber: 10_001 }, { partNumber: 1.5 }, { uploadId: "x".repeat(1025) }]);

    const res = {
      url: "https://acct.r2.cloudflarestorage.com/emberwalk-media/originals/w1?partNumber=1&uploadId=x",
      method: "PUT",
      headers: { "content-length": "10485760" },
      expiresAt: AT,
    };
    roundTrips(PartLinkResponse, res);
    refusesMissingAndExtra(PartLinkResponse, res);
    refusesEach(PartLinkResponse, res, [
      { method: "POST" },
      { url: "ftp://example.org/x" },
      { headers: { "content-length": "0" } },
      { headers: { "content-length": "12a" } },
      { headers: { "content-length": "1", authorization: "x" } },
    ]);
  });

  it("round trips the complete request and refuses repeated or missing parts", () => {
    const req = { uploadId: UPLOAD, parts: [{ partNumber: 1, etag: '"e1"' }, { partNumber: 2, etag: '"e2"' }] };
    roundTrips(CompleteUploadRequest, req);
    refusesMissingAndExtra(CompleteUploadRequest, req);
    refusesEach(CompleteUploadRequest, req, [
      { parts: [] },
      { parts: [{ partNumber: 1, etag: "a" }, { partNumber: 1, etag: "b" }] },
      { parts: [{ partNumber: 1, etag: "" }] },
      { parts: [{ partNumber: 1 }] },
    ]);
  });

  it("round trips the abort request", () => {
    roundTrips(AbortUploadRequest, { uploadId: UPLOAD });
    refusesMissingAndExtra(AbortUploadRequest, { uploadId: UPLOAD });
  });

  it("has an error body for every upload refusal", () => {
    expect(UPLOAD_REFUSALS).toContain("unknown_upload");
    expect(UPLOAD_REFUSALS).toContain("walk_not_uploading");
    expect(UPLOAD_REFUSALS).toContain("parts_invalid");
    for (const code of UPLOAD_REFUSALS) roundTrips(ErrorBody, { error: { code, message: "Plain words." } });
  });
});

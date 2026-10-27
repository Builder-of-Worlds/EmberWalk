import { describe, it } from "vitest";
import { UploadId } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("UploadId", () => {
  it("round trips the characters a multipart upload id uses, from 1 to 1,024 of them", () => {
    for (const upload of ["a", "VXBsb2FkIElE.abc_123~+/=-", "u".repeat(1024)]) roundTrips(UploadId, upload);
  });

  it("refuses an empty id, one past 1,024, spaces, quotes, line breaks and other types", () => {
    for (const value of ["", "u".repeat(1025), "a b", 'a"b', "a\nb", "a#b", "a?b", 12, null]) refuses(UploadId, value);
  });
});

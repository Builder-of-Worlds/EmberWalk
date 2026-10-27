import { describe, expect, it } from "vitest";
import { ERROR_CODES, ErrorCode, UPLOAD_REFUSALS } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("ERROR_CODES and ErrorCode", () => {
  it("round trips every listed code, and the list holds each upload refusal and the four upload endpoint codes once", () => {
    for (const code of ERROR_CODES) roundTrips(ErrorCode, code);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
    for (const code of [...UPLOAD_REFUSALS, "body_too_large", "unknown_walk", "upload_in_progress", "not_mp4"]) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it("refuses a code that is not listed, in any other case or type", () => {
    for (const value of ["oops", "", "NOT_FOUND", "not found", 404, null]) refuses(ErrorCode, value);
  });
});

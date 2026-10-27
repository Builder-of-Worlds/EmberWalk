import { describe, it } from "vitest";
import { CompletedPart } from "../src/index.ts";
import { refusesEach, refusesMissingAndExtra, roundTrips } from "./check.ts";

const part = { partNumber: 3, etag: '"9b2cf535f27731c974343645a3985328"' };

describe("CompletedPart", () => {
  it("round trips a part number with its etag, at the etag length limit", () => {
    roundTrips(CompletedPart, part);
    roundTrips(CompletedPart, { partNumber: 10_000, etag: "e".repeat(200) });
  });

  it("refuses a bad part number, an empty or long etag, a missing or extra field", () => {
    refusesEach(CompletedPart, part, [{ partNumber: 0 }, { partNumber: 10_001 }, { etag: "" }, { etag: "e".repeat(201) }, { etag: 7 }]);
    refusesMissingAndExtra(CompletedPart, part);
  });
});

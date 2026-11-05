import { describe, expect, it } from "vitest";
import { parseStills } from "../src/validate.ts";

const still = (extra: Record<string, unknown>) => ({ input: "https://r2.example/originals/w/walk.mp4", stills: [{ time: 1, output: "https://r2.example/stills/w/1.jpg", ...extra }] });

describe("parseStills and the small report copy", () => {
  it("keeps a small copy link when one is asked for, and adds none when it is not", () => {
    expect(parseStills(still({ small: "https://r2.example/stills/w/1.small.jpg" })).stills[0]?.small).toBe("https://r2.example/stills/w/1.small.jpg");
    expect(parseStills(still({})).stills[0]).not.toHaveProperty("small");
  });

  it.each([["a bucket key", "stills/w/1.small.jpg"], ["an empty string", ""], ["a number", 7], ["a file link", "file:///tmp/1.jpg"]])(
    "refuses %s as the small copy's link with 400 invalid_url",
    (_name, small) => {
      expect(() => parseStills(still({ small }))).toThrow(expect.objectContaining({ status: 400, code: "invalid_url" }));
    },
  );
});

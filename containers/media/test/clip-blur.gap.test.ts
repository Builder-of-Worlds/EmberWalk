import { describe, expect, it } from "vitest";
import { parseClip } from "../src/validate.ts";

describe('privacy blur with SAM on stills and Play clips', () => {
  it("a clip request carries blur regions the way a still request does", () => {
    const request = parseClip({
      input: "http://127.0.0.1:9/in.mp4",
      output: "http://127.0.0.1:9/out.mp4",
      start: 0,
      end: 3,
      regions: [[0.1, 0.1, 0.3, 0.3]],
    });
    expect(request).toMatchObject({ regions: [[0.1, 0.1, 0.3, 0.3]] });
  });
});

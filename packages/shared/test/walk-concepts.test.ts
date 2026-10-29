import { describe, expect, it } from "vitest";
import { LOOP_CONCEPTS, PAN_CONCEPTS } from "../src/index.ts";

describe("the two part walk's concept lists", () => {
  it("looks for 15 concepts on the loop and 8 on the corner pans, every pan concept one a loop can find", () => {
    expect(LOOP_CONCEPTS).toHaveLength(15);
    expect(PAN_CONCEPTS).toHaveLength(8);
    const loop: readonly string[] = LOOP_CONCEPTS;
    expect(PAN_CONCEPTS.filter((concept) => !loop.includes(concept))).toEqual([]);
  });
});

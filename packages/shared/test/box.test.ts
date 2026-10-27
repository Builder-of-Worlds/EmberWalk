import { describe, it } from "vitest";
import { Box } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("Box", () => {
  it("round trips a box with a positive width and height, edges included", () => {
    roundTrips(Box, [0.25, 0.5, 0.75, 0.9]);
    roundTrips(Box, [0, 0, 1, 1]);
  });

  it("refuses a box with no width, no height or corners the wrong way round", () => {
    for (const box of [[0.5, 0, 0.5, 1], [0, 0.5, 1, 0.5], [0.6, 0, 0.4, 1], [0, 0.6, 1, 0.4]]) refuses(Box, box);
  });

  it("refuses values outside 0 to 1, the wrong length and the wrong type", () => {
    for (const box of [[0, 0, 1.1, 1], [-0.1, 0, 1, 1], [0, 0, 1], [0, 0, 1, 1, 1], "0,0,1,1", { x: 0 }, null]) refuses(Box, box);
  });
});

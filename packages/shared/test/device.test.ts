import { describe, it } from "vitest";
import { Device } from "../src/index.ts";
import { refusesEach, refusesMissingAndExtra, roundTrips } from "./check.ts";

const device = { camera: "back wide", width: 1920, height: 1080 };

describe("Device", () => {
  it("round trips a camera with its size, at the size limit", () => {
    roundTrips(Device, device);
    roundTrips(Device, { camera: "c".repeat(100), width: 8192, height: 8192 });
  });

  it("refuses an empty or long camera name, a zero, fractional or oversize frame, a missing or extra field", () => {
    refusesEach(Device, device, [
      { camera: "" },
      { camera: "   " },
      { camera: "c".repeat(101) },
      { width: 0 },
      { height: 0 },
      { width: 8193 },
      { height: 8193 },
      { width: 1920.5 },
      { width: "1920" },
    ]);
    refusesMissingAndExtra(Device, device);
  });
});

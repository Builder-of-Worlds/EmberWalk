import { describe, expect, it } from "vitest";
import { FileKey, Fingerprint, Id, Language, Point, Text, Timestamp, Unit } from "../src/index.ts";
import { AT, FP, id, refuses, roundTrips } from "./check.ts";

describe("common shapes", () => {
  it("accepts ids, times, fingerprints and languages", () => {
    roundTrips(Id, id(1));
    roundTrips(Timestamp, AT);
    roundTrips(Fingerprint, FP);
    roundTrips(Language, "es");
    for (const bad of ["1", "00000000-0000-4000-8000-00000000000g", 7]) refuses(Id, bad);
    for (const bad of ["2026-10-26", "yesterday", 1761498000000]) refuses(Timestamp, bad);
    for (const bad of [FP.toUpperCase(), FP.slice(1), `${FP}a`]) refuses(Fingerprint, bad);
    refuses(Language, "fr");
  });

  it("accepts file keys only inside the known folders", () => {
    for (const key of ["originals/w1/walk.mp4", "clips/w1/loop-1.mp4", "cache/ab/cd.json", "reports/w1/r.pdf"]) roundTrips(FileKey, key);
    for (const bad of ["other/x", "/originals/x", "originals/", "originals/../x", "originals/a/../../x", "originals/a b"]) refuses(FileKey, bad);
    roundTrips(FileKey, "stills/w1/a..b.jpg");
  });

  it("keeps points on the frame", () => {
    roundTrips(Point, { x: 0, y: 1 });
    roundTrips(Unit, 0.5);
    for (const bad of [{ x: -0.01, y: 0 }, { x: 0, y: 1.01 }, { x: 0 }, { x: 0, y: 0, z: 0 }]) refuses(Point, bad);
  });

  it("trims text and holds its length", () => {
    expect(Text(3).parse("  abc ")).toBe("abc");
    refuses(Text(3), "abcd");
    refuses(Text(3), "   ");
    refuses(Text(3), "");
  });
});

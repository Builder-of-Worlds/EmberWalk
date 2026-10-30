import { describe, expect, it } from "vitest";
import { BAND_FEET, Finding, FindingStatus, MapPin, PIN_SIDES_CLOCKWISE, Preview, Recheck, Report, Rule, SIDES, ViewPreference } from "../src/index.ts";
import { AT, id, refuses, refusesEach, refusesMissingAndExtra, roundTrips } from "./check.ts";

const finding = {
  id: id(10),
  walkId: id(1),
  concept: "shrub",
  trackIds: [id(4)],
  band: "zone_0",
  distanceFeet: { low: 2, high: 4.5 },
  contact: "no",
  severity: 7,
  rank: 1,
  proofFrame: { clipId: id(3), frame: 12, still: "stills/w1/12.jpg" },
  ruleIds: ["ca-zone0-plants"],
  label: "required_now",
  instruction: "Remove the dead shrub within five feet of the wall.",
  plantState: "dead",
  spacing: "too_close",
  voiceNote: null,
  veto: null,
  source: "found",
  status: "needs_fixing",
};

const rule = {
  id: "ca-zone0-plants",
  state: "CA",
  zone: "zone_0",
  concept: "shrub",
  condition: "Within five feet of the house",
  requirement: "No combustible plants",
  citation: "Sample citation 1",
  sourceUrl: "https://example.org/rule",
  status: "recommended",
  plain: { en: "Keep plants away from the wall.", es: "Mantenga las plantas lejos de la pared." },
  retrievedOn: "2026-10-25",
};

describe("findings and what hangs off them", () => {
  it("names three bands with their distances", () => {
    expect(BAND_FEET).toEqual({ zone_0: [0, 5], zone_1: [5, 30], zone_2: [30, 100] });
  });

  it("uses the three finding statuses", () => {
    expect(FindingStatus.options).toEqual(["needs_fixing", "fix_planned", "done"]);
    refuses(FindingStatus, "open");
  });

  it("round trips a finding and refuses a bad one", () => {
    roundTrips(Finding, finding);
    roundTrips(Finding, { ...finding, voiceNote: "too close", veto: { reason: "it is a fake plant" }, status: "done" });
    refusesMissingAndExtra(Finding, finding);
    refusesEach(Finding, finding, [
      { severity: 0 },
      { severity: 11 },
      { severity: 7.5 },
      { rank: 0 },
      { band: "zone_3" },
      { contact: "maybe" },
      { label: "optional" },
      { instruction: "" },
      { ruleIds: ["Bad Rule"] },
      { trackIds: Array.from({ length: 17 }, (_, i) => id(i)) },
      { distanceFeet: { low: 5, high: 4.9 } },
      { distanceFeet: { low: -1, high: 2 } },
    ]);
    roundTrips(Finding, { ...finding, severity: 1, distanceFeet: { low: 3, high: 3 } });
    roundTrips(Finding, { ...finding, severity: 10 });
  });

  it("needs a track for a found finding but not for a tapped one", () => {
    refuses(Finding, { ...finding, trackIds: [] });
    roundTrips(Finding, { ...finding, trackIds: [], source: "tapped" });
  });

  it("gives plant state only to plants and spacing only to trees and shrubs", () => {
    refuses(Finding, { ...finding, concept: "wood_pile", spacing: null });
    refuses(Finding, { ...finding, concept: "dry_grass" });
    roundTrips(Finding, { ...finding, concept: "dry_grass", spacing: null });
    roundTrips(Finding, { ...finding, concept: "tree" });
    roundTrips(Finding, { ...finding, concept: "wood_pile", plantState: null, spacing: null });
  });

  it("round trips a rule and refuses a bad one", () => {
    roundTrips(Rule, rule);
    refusesMissingAndExtra(Rule, rule);
    refusesEach(Rule, rule, [
      { state: "ca" },
      { sourceUrl: "http://example.org/rule" },
      { sourceUrl: "not a url" },
      { status: "maybe" },
      { retrievedOn: "Oct 25" },
      { plain: { en: "only english" } },
    ]);
  });

  it("round trips rechecks, previews, reports, pins and view choices", () => {
    const recheck = { id: id(20), findingId: id(10), photo: "rechecks/w1/a.jpg", result: "still_there", createdAt: AT };
    roundTrips(Recheck, recheck);
    refusesMissingAndExtra(Recheck, recheck);
    refuses(Recheck, { ...recheck, result: "gone" });

    const preview = { id: id(21), findingId: id(10), image: "previews/w1/a.png", createdAt: AT };
    roundTrips(Preview, preview);
    refusesMissingAndExtra(Preview, preview);

    const report = { id: id(22), walkId: id(1), file: "reports/w1/r.pdf", createdAt: AT, language: "es" };
    roundTrips(Report, report);
    refusesMissingAndExtra(Report, report);

    const pin = { findingId: id(10), side: "back", band: "zone_1", position: 0.2, feet: 12 };
    roundTrips(MapPin, pin);
    roundTrips(MapPin, { ...pin, position: 0, feet: 0 });
    roundTrips(MapPin, { ...pin, position: 1, feet: 99.9 });
    refusesMissingAndExtra(MapPin, pin);
    refusesEach(MapPin, pin, [
      { side: "top" },
      { side: "back_left" },
      { position: 1.01 },
      { position: -0.01 },
      { position: { x: 0.2, y: 0.8 } },
      { feet: -1 },
      { feet: 100 },
      { latitude: 38.58 },
      { longitude: -121.49 },
      { lat: 38.58, lng: -121.49 },
    ]);

    roundTrips(ViewPreference, "simple");
    roundTrips(ViewPreference, "detailed");
    refuses(ViewPreference, "fancy");
  });

  it("names the sides of a pin in clockwise order seen from above, the way round opposite to the order a walk takes them", () => {
    expect(PIN_SIDES_CLOCKWISE).toEqual(["front", "left", "back", "right"]);
    expect([...PIN_SIDES_CLOCKWISE].reverse()).toEqual(["right", "back", "left", "front"]);
    expect([PIN_SIDES_CLOCKWISE[0], ...[...SIDES].slice(1).reverse()]).toEqual([...PIN_SIDES_CLOCKWISE]);
    for (const side of PIN_SIDES_CLOCKWISE) roundTrips(MapPin, { findingId: id(10), side, band: "zone_1", position: 0.5, feet: 12 });
  });
});

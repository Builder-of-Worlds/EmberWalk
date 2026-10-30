import { describe, expect, it } from "vitest";
import {
  ErrorBody,
  FaultReportRequest,
  FaultReportResponse,
  HealthResponse,
  GAP_KINDS,
  HINTS_FOR,
  isCorner,
  JudgeSampleResponse,
  LOOP_CONCEPTS,
  PARTS,
  PreviewRequest,
  PreviewResponse,
  previewPath,
  RecheckLinkRequest,
  RecheckLinkResponse,
  ReportRequest,
  ReportResponse,
  ShareRequest,
  ShareResponse,
  StartWalkRequest,
  StartWalkResponse,
  TapRequest,
  stillPath,
  TapResponse,
  VISITOR_HEADER,
  WalkResultsResponse,
  WalkStatusResponse,
} from "../src/index.ts";
import { AT, FP, id, refuses, refusesEach, refusesMissingAndExtra, roundTrips } from "./check.ts";

const walk = {
  id: id(1),
  visitorId: FP,
  createdAt: AT,
  state: { name: "done" },
  lengthSeconds: 300,
  language: "en",
  jurisdiction: "ca_sra",
  shareCode: null,
  device: { camera: "back", width: 1920, height: 1080 },
  synthetic: true,
  motionFile: null,
};

const finding = {
  id: id(10),
  walkId: id(1),
  concept: "wood_pile",
  trackIds: [],
  band: "zone_0",
  distanceFeet: { low: 0, high: 1 },
  contact: "yes",
  severity: 10,
  rank: 1,
  proofFrame: { clipId: id(3), frame: 4, still: "stills/w1/4.jpg" },
  ruleIds: [],
  label: "required_now",
  instruction: "Move the wood pile away from the wall.",
  plantState: null,
  spacing: null,
  voiceNote: null,
  veto: null,
  source: "tapped",
  status: "fix_planned",
};

describe("api contracts", () => {
  it("starts a walk", () => {
    const req = { language: "en", jurisdiction: "ca_sra", device: walk.device, synthetic: false, visitorId: FP };
    refusesMissingAndExtra(StartWalkRequest, req);
    refuses(StartWalkRequest, { ...req, address: "1 Main St" });
    refusesEach(StartWalkRequest, req, [
      { visitorId: FP.slice(1) },
      { visitorId: `${FP}a` },
      { visitorId: FP.toUpperCase() },
      { visitorId: null },
    ]);
    expect(StartWalkRequest.parse(req)).toEqual({ ...req, partOf: null });
    roundTrips(StartWalkRequest, { ...req, partOf: { walkId: id(1), side: "back" } });
    roundTrips(StartWalkRequest, { ...req, partOf: null });
    refusesEach(StartWalkRequest, req, [
      { partOf: { walkId: id(1) } },
      { partOf: { walkId: id(1), side: "roof" } },
      { partOf: { walkId: "w1", side: "back" } },
      { partOf: { walkId: id(1), side: "back", extra: 1 } },
      { partOf: id(1) },
    ]);
    roundTrips(StartWalkRequest, { ...req, partOf: null, startKey: id(2) });
    refusesEach(StartWalkRequest, req, [{ startKey: "take-1" }, { startKey: null }, { startKey: 7 }, { startKey: `${id(2)}0` }]);
    roundTrips(StartWalkResponse, { walkId: id(1), state: { name: "recording" } });
    refusesMissingAndExtra(StartWalkResponse, { walkId: id(1), state: { name: "recording" } });
  });

  it("reports status and results", () => {
    const failure = { code: "segment_failed", message: "Something went wrong while checking this walk. Please try again." };
    const status = { walkId: id(1), state: { name: "failed", step: "segment" }, failure };
    roundTrips(WalkStatusResponse, status);
    roundTrips(WalkStatusResponse, { walkId: id(1), state: { name: "processing", step: "prepare" }, failure: null });
    refusesMissingAndExtra(WalkStatusResponse, status);
    refusesEach(WalkStatusResponse, status, [{ updatedAt: AT }, { failure: { code: "x" } }, { failure: { ...failure, message: "" } }]);

    const result = {
      id: id(10),
      concept: "wood_pile",
      band: "zone_0",
      distanceFeet: { low: 0, high: 1 },
      label: "required_now",
      instruction: "Move the wood pile away from the wall.",
      sources: [{ citation: "14 CCR 1299.03", words: "Remove dead plants.", status: "in_force", url: "https://bof.fire.ca.gov/", retrievedOn: "2026-10-26" }],
      confidence: 0.9,
      proof: { still: stillPath(id(1), id(10)), frame: 4, seconds: 2.5, marker: [0.1, 0.2, 0.3, 0.4] },
      voiceNote: null,
    };
    const results = { walkId: id(1), walkedOn: "2026-10-27", synthetic: true, coverage: "not_checked", gaps: [], parts: [], findings: [result], notChecked: ["chimney"] };
    roundTrips(WalkResultsResponse, results);
    const said = { ...result, voiceNote: "The woodpile is against the garage wall." };
    roundTrips(WalkResultsResponse, { ...results, findings: [said] });
    roundTrips(WalkResultsResponse, { ...results, findings: [{ ...result, voiceNote: "x".repeat(2000) }] });
    const unsaid = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "voiceNote"));
    for (const finding of [unsaid,{ ...result, voiceNote: "x".repeat(2001) }, { ...result, voiceNote: "  " }, { ...result, voiceNote: 7 }]) {
      refuses(WalkResultsResponse, { ...results, findings: [finding] });
    }
    for (const preview of [null, previewPath(id(1), id(10))]) roundTrips(WalkResultsResponse, { ...results, findings: [{ ...result, preview }] });
    roundTrips(WalkResultsResponse, { ...results, parts: [{ walkId: id(2), side: "right" }], findings: [{ ...result, preview: previewPath(id(2), id(10)) }] });
    for (const preview of [previewPath(id(1), id(11)), previewPath(id(3), id(10)), stillPath(id(1), id(10)), "previews/w1/10.png", 7]) {
      refuses(WalkResultsResponse, { ...results, findings: [{ ...result, preview }] });
    }
    for (const secondCheck of [null, { verdict: "agrees", reason: "The photo shows wood against the wall." }, { verdict: "flags", reason: "x".repeat(300) }]) {
      roundTrips(WalkResultsResponse, { ...results, findings: [{ ...result, secondCheck }] });
    }
    for (const secondCheck of [{ verdict: "maybe", reason: "Unsure." }, { verdict: "flags", reason: "  " }, { verdict: "flags", reason: "x".repeat(301) }, { verdict: "agrees" }, { verdict: "agrees", reason: "Fine.", model: "x" }]) {
      refuses(WalkResultsResponse, { ...results, findings: [{ ...result, secondCheck }] });
    }
    roundTrips(WalkResultsResponse, { ...results, findings: [], notChecked: [] });

    const pin = { findingId: id(10), side: "back", band: "zone_0", position: 0.25, feet: 0 };
    roundTrips(WalkResultsResponse, { ...results, pins: [pin] });
    roundTrips(WalkResultsResponse, { ...results, pins: [] });
    for (const pins of [
      [{ ...pin, findingId: id(11) }],
      [{ ...pin, band: "zone_1" }],
      [pin, pin],
      [{ ...pin, latitude: 38.58, longitude: -121.49 }],
      [{ ...pin, position: { x: 0.2, y: 0.8 } }],
      [{ ...pin, feet: -1 }],
    ]) {
      refuses(WalkResultsResponse, { ...results, pins });
    }
    for (const loop of ["closed", "open", "not_checked"]) roundTrips(WalkResultsResponse, { ...results, loop });
    roundTrips(WalkResultsResponse, { ...results, coverage: "checked", loop: "closed", notChecked: [] });
    expect(WalkResultsResponse.parse(results).loop).toBeUndefined();
    const partResult = { ...result, id: id(11), proof: { ...result.proof, still: stillPath(id(2), id(11)) } };
    const gaps = [
      { side: "back", kind: "not_checked", hint: "again" },
      { side: "left", kind: "first_five_feet", hint: "tilt_down" },
      { side: "left", kind: "dark", hint: "more_light" },
    ];
    roundTrips(WalkResultsResponse, { ...results, gaps, parts: [{ walkId: id(2), side: "right" }], findings: [result, partResult] });
    const many = { ...results, parts: [{ walkId: id(2), side: "right" }], findings: [...Array(500).fill(result), ...Array(500).fill(partResult)] };
    expect(WalkResultsResponse.safeParse(many).success).toBe(true);
    refuses(WalkResultsResponse, { ...many, findings: Array(2501).fill(result) });
    refusesMissingAndExtra(WalkResultsResponse, results);
    refusesEach(WalkResultsResponse, results, [
      { notChecked: ["car"] },
      { view: "simple" },
      { pins: [{}] },
      { coverage: "checked" },
      { coverage: "checked", notChecked: [], gaps },
      { coverage: "checked", notChecked: ["chimney"], gaps: [] },
      { coverage: "complete" },
      { loop: "around" },
      { loop: null },
      { gaps: [{ side: "front", kind: "missing" }] },
      { gaps: [{ side: "roof", kind: "missing", hint: "walk_side" }] },
      { gaps: [{ side: "front", kind: "smoke", hint: "walk_side" }] },
      { gaps: [{ side: "front", kind: "missing", hint: "more_light" }] },
      { gaps: [{ side: "front", kind: "not_checked", hint: "walk_side" }] },
      { gaps: [gaps[0], gaps[0]] },
      { gaps: [gaps[1], { ...gaps[1], hint: "step_back" }] },
      { parts: [{ walkId: id(2), side: "back" }, { walkId: id(3), side: "back" }] },
      { parts: [{ walkId: id(1), side: "back" }] },
      { parts: [{ walkId: id(2), side: "roof" }] },
      { findings: [partResult] },
      { parts: [{ walkId: id(3), side: "back" }], findings: [partResult] },
      { walkedOn: AT },
      { findings: [{ ...result, sources: [] }] },
      { findings: [{ ...result, confidence: 1.5 }] },
      { findings: [{ ...result, distanceFeet: { low: 2, high: 1 } }] },
      { findings: [{ ...result, proof: { ...result.proof, marker: [0.3, 0.2, 0.1, 0.4] } }] },
      { findings: [{ ...result, proof: { ...result.proof, still: "stills/w1/4.jpg" } }] },
      { findings: [{ ...result, proof: { ...result.proof, still: stillPath(id(2), id(10)) } }] },
      { findings: [{ ...result, sources: [{ ...result.sources[0], url: "http://bof.fire.ca.gov/" }] }] },
    ]);
    expect(stillPath(id(1), id(10))).toBe(`/api/walks/${id(1)}/stills/${id(10)}`);
    expect(previewPath(id(1), id(10))).toBe(`/api/walks/${id(1)}/previews/${id(10)}`);
    expect(VISITOR_HEADER).toBe("x-emberwalk-visitor");

    roundTrips(JudgeSampleResponse, { walk, findings: [finding] });
    refusesMissingAndExtra(JudgeSampleResponse, { walk, findings: [finding] });
  });

  it("names every loop concept that went unchecked, and no more", () => {
    const results = { walkId: id(1), walkedOn: "2026-10-27", synthetic: true, coverage: "not_checked", gaps: [], parts: [], findings: [] };
    expect(LOOP_CONCEPTS.length).toBeGreaterThan(15);
    roundTrips(WalkResultsResponse, { ...results, notChecked: [...LOOP_CONCEPTS] });
    roundTrips(WalkResultsResponse, { ...results, notChecked: LOOP_CONCEPTS.slice(0, 16) });
    refuses(WalkResultsResponse, { ...results, notChecked: [...LOOP_CONCEPTS, "chimney"] });
    refuses(WalkResultsResponse, { ...results, notChecked: [...LOOP_CONCEPTS.slice(1), "roof"] });
    refuses(WalkResultsResponse, { ...results, coverage: "checked", loop: "closed", notChecked: [...LOOP_CONCEPTS] });
  });

  it("carries a part walk and a gap for every side and corner, one each", () => {
    const results = { walkId: id(1), walkedOn: "2026-10-27", synthetic: false, coverage: "not_checked", gaps: [], findings: [], notChecked: [] };
    const parts = PARTS.map((side, i) => ({ walkId: id(20 + i), side }));
    const start = { language: "en", jurisdiction: "ca_sra", device: walk.device, synthetic: false, visitorId: FP };
    roundTrips(WalkResultsResponse, { ...results, parts });
    roundTrips(StartWalkRequest, { ...start, partOf: { walkId: id(2), side: "back_left" } });
    refuses(StartWalkRequest, { ...start, partOf: { walkId: id(2), side: "back left" } });
    refuses(WalkResultsResponse, { ...results, parts: [...parts, { walkId: id(40), side: "front" }] });
    refuses(WalkResultsResponse, { ...results, parts: [parts[4], { ...parts[4]!, walkId: id(41) }] });
    const gaps = PARTS.flatMap((side) =>
      GAP_KINDS.map((kind) => ({ side, kind, hint: kind === "missing" ? (isCorner(side) ? "pan_corner" : "walk_side") : HINTS_FOR[kind][0] })),
    );
    expect(gaps).toHaveLength(32);
    roundTrips(WalkResultsResponse, { ...results, parts: [], gaps });
    refuses(WalkResultsResponse, { ...results, parts: [], gaps: [...gaps, gaps[0]] });
  });

  it("adds a tapped object", () => {
    const tap = { walkId: id(1), clipId: id(3), frame: 4, at: { x: 0.25, y: 0.75 } };
    roundTrips(TapRequest, tap);
    refusesMissingAndExtra(TapRequest, tap);
    refusesEach(TapRequest, tap, [{ frame: -1 }, { at: { x: 1.5, y: 0 } }]);
    roundTrips(TapResponse, { finding });
    refuses(TapResponse, {});
  });

  it("asks for a preview, a recheck link, a report and a share link", () => {
    roundTrips(PreviewRequest, { findingId: id(10) });
    refusesMissingAndExtra(PreviewRequest, { findingId: id(10) });
    const preview = { preview: { id: id(21), findingId: id(10), image: "previews/w1/a.png", createdAt: AT }, url: "https://app.emberwalk.app/p/a" };
    roundTrips(PreviewResponse, preview);
    refusesMissingAndExtra(PreviewResponse, preview);

    const recheck = { findingId: id(10), contentType: "image/jpeg", bytes: 2_000_000 };
    roundTrips(RecheckLinkRequest, recheck);
    roundTrips(RecheckLinkRequest, { ...recheck, bytes: 20 * 1024 * 1024 });
    refusesMissingAndExtra(RecheckLinkRequest, recheck);
    refusesEach(RecheckLinkRequest, recheck, [{ bytes: 20 * 1024 * 1024 + 1 }, { bytes: 0 }, { contentType: "image/gif" }]);
    const link = {
      recheckId: id(20),
      url: "https://acct.r2.cloudflarestorage.com/emberwalk-media/rechecks/w1/a.jpg",
      method: "PUT",
      headers: { "content-length": "2000000", "content-type": "image/jpeg" },
      expiresAt: AT,
    };
    roundTrips(RecheckLinkResponse, link);
    refusesMissingAndExtra(RecheckLinkResponse, link);

    roundTrips(ReportRequest, { walkId: id(1), language: "es" });
    refusesMissingAndExtra(ReportRequest, { walkId: id(1), language: "es" });
    const report = { reportId: id(22), url: "https://app.emberwalk.app/r/a.pdf", expiresAt: AT };
    roundTrips(ReportResponse, report);
    refusesMissingAndExtra(ReportResponse, report);

    roundTrips(ShareRequest, { walkId: id(1) });
    refusesMissingAndExtra(ShareRequest, { walkId: id(1) });
    const share = { shareCode: "abc123xyz0", url: "https://app.emberwalk.app/s/abc123xyz0" };
    roundTrips(ShareResponse, share);
    refusesMissingAndExtra(ShareResponse, share);
    refuses(ShareResponse, { ...share, url: "http://app.emberwalk.app/s/abc123xyz0" });
  });

  it("answers health and refuses with a plain error body", () => {
    roundTrips(HealthResponse, { ok: true, version: "0.1.0" });
    refuses(HealthResponse, { ok: false, version: "0.1.0" });
    const error = { error: { code: "spend_cap_reached", message: "Live walks are paused until tomorrow." } };
    roundTrips(ErrorBody, error);
    refusesEach(ErrorBody, error, [{ error: { code: "oops", message: "x" } }, { error: { code: "not_found", message: "" } }, { error: {} }]);
  });

  it("takes a fault report with a known code and a short build", () => {
    const fault = { walkId: id(1), code: "invalid_request", build: "a1b2c3d4e5f6" };
    roundTrips(FaultReportRequest, fault);
    roundTrips(FaultReportRequest, { ...fault, build: "dev" });
    roundTrips(FaultReportRequest, { ...fault, build: "a".repeat(40) });
    roundTrips(FaultReportResponse, { received: true });
  });

  it("refuses a fault report that is malformed, unknown or carries more than it should", () => {
    const fault = { walkId: id(1), code: "invalid_request", build: "a1b2c3d4e5f6" };
    refusesEach(FaultReportRequest, fault, [
      { walkId: "not-a-uuid" },
      { code: "oops" },
      { code: "offline" },
      { code: "" },
      { build: "A1B2C3" },
      { build: "a1 b2" },
      { build: "a-b" },
      { build: "" },
      { build: "a".repeat(41) },
      { build: 12 },
    ]);
    refusesMissingAndExtra(FaultReportRequest, fault);
    refuses(FaultReportRequest, {});
    refuses(FaultReportRequest, { walkId: id(1), build: "dev" });
    refuses(FaultReportResponse, { received: false });
    refuses(FaultReportResponse, {});
    refuses(FaultReportResponse, { received: true, extra: 1 });
  });

  it("names the codes the upload endpoints answer with", () => {
    for (const code of ["body_too_large", "unknown_walk", "upload_in_progress", "not_mp4"]) {
      roundTrips(ErrorBody, { error: { code, message: "Plain words." } });
    }
    refuses(ErrorBody, { error: { code: "not_mp3", message: "Plain words." } });
  });
});

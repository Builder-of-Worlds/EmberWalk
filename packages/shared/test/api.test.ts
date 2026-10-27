import { describe, it } from "vitest";
import {
  ErrorBody,
  HealthResponse,
  JudgeSampleResponse,
  PreviewRequest,
  PreviewResponse,
  RecheckLinkRequest,
  RecheckLinkResponse,
  ReportRequest,
  ReportResponse,
  ShareRequest,
  ShareResponse,
  StartWalkRequest,
  StartWalkResponse,
  TapRequest,
  TapResponse,
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
    const req = { language: "en", jurisdiction: "ca_sra", device: walk.device, synthetic: false };
    roundTrips(StartWalkRequest, req);
    refusesMissingAndExtra(StartWalkRequest, req);
    refuses(StartWalkRequest, { ...req, address: "1 Main St" });
    roundTrips(StartWalkResponse, { walkId: id(1), state: { name: "recording" } });
    refusesMissingAndExtra(StartWalkResponse, { walkId: id(1), state: { name: "recording" } });
  });

  it("reports status and results", () => {
    const status = { walkId: id(1), state: { name: "failed", step: "segment" }, updatedAt: AT };
    roundTrips(WalkStatusResponse, status);
    refusesMissingAndExtra(WalkStatusResponse, status);

    const results = {
      walk,
      findings: [finding],
      pins: [{ findingId: id(10), side: "front", band: "zone_0", position: { x: 0.5, y: 0.5 } }],
      notChecked: ["chimney"],
      view: "simple",
    };
    roundTrips(WalkResultsResponse, results);
    refusesMissingAndExtra(WalkResultsResponse, results);
    refusesEach(WalkResultsResponse, results, [{ notChecked: ["car"] }, { view: "fancy" }, { findings: [{ ...finding, severity: 0 }] }]);

    roundTrips(JudgeSampleResponse, { walk, findings: [finding] });
    refusesMissingAndExtra(JudgeSampleResponse, { walk, findings: [finding] });
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

  it("names the codes the upload endpoints answer with", () => {
    for (const code of ["body_too_large", "unknown_walk", "upload_in_progress", "not_mp4"]) {
      roundTrips(ErrorBody, { error: { code, message: "Plain words." } });
    }
    refuses(ErrorBody, { error: { code: "not_mp3", message: "Plain words." } });
  });
});

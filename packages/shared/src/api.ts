import { z } from "zod";
import { Fingerprint, Id, Language, Point, Text, Timestamp, Unit } from "./common.ts";
import { Finding, Preview, Rule } from "./finding.ts";
import { UPLOAD_REFUSALS } from "./upload.ts";
import { Box, Concept, Device, Gap, Jurisdiction, Side, Walk, WalkState } from "./walk.ts";

export const VISITOR_HEADER = "x-emberwalk-visitor";

export const WalkPart = z.strictObject({ walkId: Id, side: Side });

export const StartWalkRequest = z.strictObject({
  partOf: WalkPart.nullable().default(null),
  language: Language,
  jurisdiction: Jurisdiction,
  device: Device,
  synthetic: z.boolean(),
  visitorId: Fingerprint,
});

export const StartWalkResponse = z.strictObject({ walkId: Id, state: WalkState });

export const WalkFailure = z.strictObject({ code: Text(60), message: Text(300) });

export const WalkStatusResponse = z.strictObject({ walkId: Id, state: WalkState, failure: WalkFailure.nullable() });

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export const stillPath = (walkId: string, findingId: string): string => `/api/walks/${walkId}/stills/${findingId}`;

export const ResultSource = z.strictObject({
  citation: Rule.shape.citation,
  words: Rule.shape.requirement,
  status: Rule.shape.status,
  url: Rule.shape.sourceUrl,
  retrievedOn: Rule.shape.retrievedOn,
});

export const ResultFinding = z.strictObject({
  id: Id,
  concept: Concept,
  band: Finding.shape.band,
  distanceFeet: Finding.shape.distanceFeet,
  label: Finding.shape.label,
  instruction: Finding.shape.instruction,
  sources: z.array(ResultSource).min(1).max(20),
  confidence: Unit,
  proof: z.strictObject({
    still: z.string().regex(new RegExp(`^/api/walks/${UUID}/stills/${UUID}$`)),
    frame: z.int().nonnegative(),
    seconds: z.number().nonnegative(),
    marker: Box,
  }),
  voiceNote: Finding.shape.voiceNote,
});

export const WalkResultsResponse = z
  .strictObject({
    walkId: Id,
    walkedOn: z.iso.date(),
    synthetic: z.boolean(),
    coverage: z.enum(["checked", "not_checked"]),
    loop: z.enum(["closed", "open", "not_checked"]).optional(),
    gaps: z.array(Gap).max(16),
    parts: z.array(WalkPart).max(4),
    findings: z.array(ResultFinding).max(2500),
    notChecked: z.array(Concept).max(15),
  })
  .refine((r) => r.coverage !== "checked" || (r.gaps.length === 0 && r.notChecked.length === 0), {
    message: "a checked walk has no gap and nothing that was not checked",
    path: ["coverage"],
  })
  .refine((r) => new Set(r.gaps.map((g) => `${g.side} ${g.kind}`)).size === r.gaps.length, {
    message: "one gap per side and kind",
    path: ["gaps"],
  })
  .refine((r) => new Set(r.parts.map((p) => p.side)).size === r.parts.length && r.parts.every((p) => p.walkId !== r.walkId), {
    message: "one part walk per side, never the walk itself",
    path: ["parts"],
  })
  .refine((r) => r.findings.every((f) => [r.walkId, ...r.parts.map((p) => p.walkId)].some((w) => f.proof.still === stillPath(w, f.id))), {
    message: "each still is the finding's own, under its walk or one of its part walks",
    path: ["findings"],
  });

export const TapRequest = z.strictObject({ walkId: Id, clipId: Id, frame: z.int().nonnegative(), at: Point });

export const TapResponse = z.strictObject({ finding: Finding });

export const PreviewRequest = z.strictObject({ findingId: Id });

export const PreviewResponse = z.strictObject({ preview: Preview, url: z.url({ protocol: /^https?$/ }) });

export const RecheckLinkRequest = z.strictObject({
  findingId: Id,
  contentType: z.enum(["image/jpeg", "image/png", "image/heic"]),
  bytes: z.int().positive().max(20 * 1024 * 1024),
});

export const RecheckLinkResponse = z.strictObject({
  recheckId: Id,
  url: z.url({ protocol: /^https?$/ }),
  method: z.literal("PUT"),
  headers: z.strictObject({ "content-length": z.string().regex(/^[1-9]\d{0,11}$/), "content-type": z.string().min(1) }),
  expiresAt: Timestamp,
});

export const ReportRequest = z.strictObject({ walkId: Id, language: Language });

export const ReportResponse = z.strictObject({ reportId: Id, url: z.url({ protocol: /^https?$/ }), expiresAt: Timestamp });

export const ShareRequest = z.strictObject({ walkId: Id });

export const ShareResponse = z.strictObject({
  shareCode: z.string().regex(/^[a-z0-9]{10}$/),
  url: z.url({ protocol: /^https$/ }),
});

export const JudgeSampleResponse = z.strictObject({ walk: Walk, findings: z.array(Finding).max(500) });

export const HealthResponse = z.strictObject({ ok: z.literal(true), version: Text(40) });

export const ERROR_CODES = [
  ...UPLOAD_REFUSALS,
  "invalid_request",
  "body_too_large",
  "unknown_walk",
  "upload_in_progress",
  "not_mp4",
  "not_found",
  "method_not_allowed",
  "spend_cap_reached",
  "walk_limit_reached",
  "walk_not_done",
  "rate_limited",
  "server_error",
] as const;

export const ErrorCode = z.enum(ERROR_CODES);

export const ErrorBody = z.strictObject({ error: z.strictObject({ code: ErrorCode, message: Text(300) }) });

export const FaultReportRequest = z.strictObject({ walkId: Id, code: ErrorCode, build: z.string().regex(/^[a-z0-9]{1,40}$/) });

export const FaultReportResponse = z.strictObject({ received: z.literal(true) });

export type WalkPart = z.infer<typeof WalkPart>;
export type StartWalkRequest = z.infer<typeof StartWalkRequest>;
export type StartWalkResponse = z.infer<typeof StartWalkResponse>;
export type WalkFailure = z.infer<typeof WalkFailure>;
export type WalkStatusResponse = z.infer<typeof WalkStatusResponse>;
export type ResultSource = z.infer<typeof ResultSource>;
export type ResultFinding = z.infer<typeof ResultFinding>;
export type WalkResultsResponse = z.infer<typeof WalkResultsResponse>;
export type TapRequest = z.infer<typeof TapRequest>;
export type TapResponse = z.infer<typeof TapResponse>;
export type PreviewRequest = z.infer<typeof PreviewRequest>;
export type PreviewResponse = z.infer<typeof PreviewResponse>;
export type RecheckLinkRequest = z.infer<typeof RecheckLinkRequest>;
export type RecheckLinkResponse = z.infer<typeof RecheckLinkResponse>;
export type ReportRequest = z.infer<typeof ReportRequest>;
export type ReportResponse = z.infer<typeof ReportResponse>;
export type ShareRequest = z.infer<typeof ShareRequest>;
export type ShareResponse = z.infer<typeof ShareResponse>;
export type JudgeSampleResponse = z.infer<typeof JudgeSampleResponse>;
export type HealthResponse = z.infer<typeof HealthResponse>;
export type ErrorCode = z.infer<typeof ErrorCode>;
export type ErrorBody = z.infer<typeof ErrorBody>;
export type FaultReportRequest = z.infer<typeof FaultReportRequest>;
export type FaultReportResponse = z.infer<typeof FaultReportResponse>;

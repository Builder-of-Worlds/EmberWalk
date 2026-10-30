import { z } from "zod";
import { AgentJob, MessageStatus, Phone, Trade, Zip } from "./agent.ts";
import { Fingerprint, Id, Language, Point, Text, Timestamp, Unit } from "./common.ts";
import { Finding, FindingStatus, MapPin, Preview, Rule } from "./finding.ts";
import { UPLOAD_REFUSALS } from "./upload.ts";
import { Box, Concept, Device, Gap, GAP_KINDS, Jurisdiction, LOOP_CONCEPTS, Part, PARTS, Walk, WalkState } from "./walk.ts";

export const VISITOR_HEADER = "x-emberwalk-visitor";

export const WalkPart = z.strictObject({ walkId: Id, side: Part });

export const StartWalkRequest = z.strictObject({
  partOf: WalkPart.nullable().default(null),
  language: Language,
  jurisdiction: Jurisdiction,
  device: Device,
  synthetic: z.boolean(),
  visitorId: Fingerprint,
  startKey: Id.optional(),
});

export const StartWalkResponse = z.strictObject({ walkId: Id, state: WalkState });

export const WalkFailure = z.strictObject({ code: Text(60), message: Text(300) });

export const WalkStatusResponse = z.strictObject({ walkId: Id, state: WalkState, failure: WalkFailure.nullable() });

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export const stillPath = (walkId: string, findingId: string): string => `/api/walks/${walkId}/stills/${findingId}`;

export const previewPath = (walkId: string, findingId: string): string => `/api/walks/${walkId}/previews/${findingId}`;

export const previewKey = (walkId: string, findingId: string): string => `previews/${walkId}/${findingId}.jpg`;

export const secondCheckKey = (walkId: string): string => `reports/${walkId}/second-check.json`;

export const SecondCheck = z.strictObject({ verdict: z.enum(["agrees", "flags"]), reason: Text(300) });

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
  preview: z.string().regex(new RegExp(`^/api/walks/${UUID}/previews/${UUID}$`)).nullable().optional(),
  secondCheck: SecondCheck.nullable().optional(),
});

export const WalkResultsResponse = z
  .strictObject({
    walkId: Id,
    walkedOn: z.iso.date(),
    synthetic: z.boolean(),
    coverage: z.enum(["checked", "not_checked"]),
    loop: z.enum(["closed", "open", "not_checked"]).optional(),
    gaps: z.array(Gap).max(PARTS.length * GAP_KINDS.length),
    parts: z.array(WalkPart).max(PARTS.length),
    findings: z.array(ResultFinding).max(2500),
    notChecked: z.array(Concept).max(LOOP_CONCEPTS.length),
    pins: z.array(MapPin).max(2500).optional(),
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
  })
  .refine((r) => r.findings.every((f) => (f.preview ?? null) === null || [r.walkId, ...r.parts.map((p) => p.walkId)].some((w) => f.preview === previewPath(w, f.id))), {
    message: "each preview is the finding's own, under its walk or one of its part walks",
    path: ["findings"],
  })
  .refine(
    (r) =>
      new Set((r.pins ?? []).map((p) => p.findingId)).size === (r.pins ?? []).length &&
      (r.pins ?? []).every((p) => r.findings.some((f) => f.id === p.findingId && f.band === p.band)),
    { message: "each pin is one of the body's findings, once, in its band", path: ["pins"] },
  );

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
  "conflict",
  "not_ready",
  "send_failed",
  "spend_cap_reached",
  "walk_limit_reached",
  "walk_not_done",
  "rate_limited",
  "server_error",
] as const;

export const ErrorCode = z.enum(ERROR_CODES);

export const FIXED_ROUTE_CODES = ["invalid_request", "not_found", "method_not_allowed", "conflict", "not_ready", "send_failed", "rate_limited", "server_error"] as const satisfies readonly ErrorCode[];

export const FIXED_CODES = ["not_found", "refused", "off", "unavailable", "send_failed", "not_ready", "rate_limited"] as const;

export const FixedZipRequest = z.strictObject({ zip: Zip });

export const FixedEmailRequest = z.strictObject({ email: z.email().max(254) });

export const FixedReplyRequest = z.strictObject({ text: z.string().trim().min(1).max(10_000) });

export const FixedMarkRequest = z.strictObject({ status: FindingStatus, note: z.string().max(200).optional(), doneOn: z.iso.date().optional() });

export const FixedCrew = z.strictObject({
  id: Id,
  name: Text(120),
  className: Text(120).nullable(),
  licenseNumber: z.string().regex(/^\d{1,8}$/).nullable(),
  licenseStatus: Text(60).nullable(),
  listedOn: z.iso.date().nullable(),
  checkLicenseUrl: z.url().nullable(),
  distanceMiles: z.number().nonnegative().nullable(),
  approximate: z.boolean(),
  phone: Phone.nullable(),
  email: z.email().nullable(),
  sample: z.boolean(),
});

export const FixedReading = z.strictObject({
  price: Text(200).nullable(),
  date: Text(200).nullable(),
  questions: z.array(Text(500)).max(10),
  declined: z.boolean(),
  summary: Text(500),
});

export const FixedReply = z.strictObject({
  id: Id,
  via: z.enum(["email", "homeowner"]),
  receivedAt: Timestamp,
  text: z.string().min(1).max(10_000),
  reading: FixedReading.nullable(),
});

export const FixedMessage = z.strictObject({
  id: Id,
  crewId: Id,
  channel: z.enum(["email", "text"]),
  status: MessageStatus,
  subject: Text(200).nullable(),
  body: Text(5000),
  createdAt: Timestamp,
  approvedAt: Timestamp.nullable(),
  sentAt: Timestamp.nullable(),
  outbox: z.strictObject({ state: z.enum(["sending", "sent", "failed"]), error: z.string().max(500).nullable() }).nullable(),
  photos: z.array(z.strictObject({ findingId: Id, url: z.string().regex(new RegExp(`^/api/walks/${UUID}/stills/${UUID}$`)) })).max(50),
  replies: z.array(FixedReply).max(200),
});

export const FixedFollowUp = z.strictObject({
  id: Id,
  forMessageId: Id,
  dueAt: Timestamp,
  note: z.string().max(500),
  draftMessageId: Id.nullable(),
  done: z.boolean(),
});

export const FixedJob = z.strictObject({
  id: Id,
  trade: Trade,
  status: AgentJob.shape.status,
  findingIds: z.array(Id).max(50),
  crews: z.array(FixedCrew).max(200),
  messages: z.array(FixedMessage).max(400),
  followUps: z.array(FixedFollowUp).max(400),
});

export const FixedJobsResponse = z.strictObject({ walkId: Id, jobs: z.array(FixedJob).max(50), yourself: z.array(Id).max(2500) });

export const FixedApprovalResponse = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("sent") }),
  z.strictObject({ status: z.literal("approved"), phone: Phone, body: Text(5000) }),
]);

export const FixedSentByPhoneResponse = z.strictObject({ status: z.literal("sent_by_phone") });

export const FixedInspectionResponse = z.strictObject({
  subject: Text(300),
  body: Text(10_000),
  links: z.array(z.strictObject({ label: Text(200), url: z.url({ protocol: /^https?$/ }) })).max(20),
});

const FixedSavedMark = z.strictObject({
  id: Id,
  findingId: Id,
  status: FindingStatus,
  note: z.string().max(200).nullable(),
  doneOn: z.iso.date().nullable(),
  markedAt: Timestamp,
});

export const FixedMarkResponse = z.strictObject({ mark: FixedSavedMark });

export const FixedHistoryResponse = z.strictObject({
  walks: z
    .array(
      z.strictObject({
        walkId: Id,
        walkedOn: z.iso.date(),
        synthetic: z.boolean(),
        state: Text(40),
        marks: z.array(FixedSavedMark.extend({ concept: Concept })).max(2500),
      }),
    )
    .max(500),
});

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
export type SecondCheck = z.infer<typeof SecondCheck>;
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
export type FixedCode = (typeof FIXED_CODES)[number];
export type FixedRouteCode = (typeof FIXED_ROUTE_CODES)[number];
export type FixedZipRequest = z.infer<typeof FixedZipRequest>;
export type FixedEmailRequest = z.infer<typeof FixedEmailRequest>;
export type FixedReplyRequest = z.infer<typeof FixedReplyRequest>;
export type FixedMarkRequest = z.infer<typeof FixedMarkRequest>;
export type FixedCrew = z.infer<typeof FixedCrew>;
export type FixedReading = z.infer<typeof FixedReading>;
export type FixedReply = z.infer<typeof FixedReply>;
export type FixedMessage = z.infer<typeof FixedMessage>;
export type FixedFollowUp = z.infer<typeof FixedFollowUp>;
export type FixedJob = z.infer<typeof FixedJob>;
export type FixedJobsResponse = z.infer<typeof FixedJobsResponse>;
export type FixedApprovalResponse = z.infer<typeof FixedApprovalResponse>;
export type FixedSentByPhoneResponse = z.infer<typeof FixedSentByPhoneResponse>;
export type FixedInspectionResponse = z.infer<typeof FixedInspectionResponse>;
export type FixedMarkResponse = z.infer<typeof FixedMarkResponse>;
export type FixedHistoryResponse = z.infer<typeof FixedHistoryResponse>;

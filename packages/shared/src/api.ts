import { z } from "zod";
import { Id, Language, Point, Text, Timestamp } from "./common.ts";
import { Finding, MapPin, Preview, ViewPreference } from "./finding.ts";
import { UPLOAD_REFUSALS } from "./upload.ts";
import { Concept, Device, Jurisdiction, Walk, WalkState } from "./walk.ts";

export const StartWalkRequest = z.strictObject({
  language: Language,
  jurisdiction: Jurisdiction,
  device: Device,
  synthetic: z.boolean(),
});

export const StartWalkResponse = z.strictObject({ walkId: Id, state: WalkState });

export const WalkStatusResponse = z.strictObject({ walkId: Id, state: WalkState, updatedAt: Timestamp });

export const WalkResultsResponse = z.strictObject({
  walk: Walk,
  findings: z.array(Finding).max(500),
  pins: z.array(MapPin).max(500),
  notChecked: z.array(Concept).max(15),
  view: ViewPreference,
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

export type StartWalkRequest = z.infer<typeof StartWalkRequest>;
export type StartWalkResponse = z.infer<typeof StartWalkResponse>;
export type WalkStatusResponse = z.infer<typeof WalkStatusResponse>;
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

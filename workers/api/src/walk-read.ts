import {
  byWalkingOrder,
  clipsForWalk,
  type Detections,
  detectionsForClip,
  findingsForWalk,
  gapsForWalk,
  getWalk,
  partsOf,
  tagsForWalk,
  type WalkRecord,
} from "@emberwalk/db";
import { CoverageRecord, coverageKey, RULES } from "@emberwalk/rules";
import {
  type Clip,
  type ClipKind,
  type Concept,
  Fingerprint,
  type Finding,
  Id,
  type ResultFinding,
  type ResultSource,
  stillPath,
  type Tag,
  VISITOR_HEADER,
  WalkResultsResponse,
  type WalkStatusResponse,
} from "@emberwalk/shared";

export const READ_PATH = /^\/api\/walks\/([^/]+)(?:\/(results)|\/stills\/([^/]+))?$/;

type Failure = "invalid_request" | "unknown_walk" | "not_found" | "method_not_allowed" | "walk_not_done" | "server_error";

const STATUS: Record<Failure, number> = {
  invalid_request: 400,
  unknown_walk: 404,
  not_found: 404,
  method_not_allowed: 405,
  walk_not_done: 409,
  server_error: 500,
};

const MESSAGE: Record<Failure, string> = {
  invalid_request: "The request is not valid.",
  unknown_walk: "That walk does not exist.",
  not_found: "That picture does not exist.",
  method_not_allowed: "Use GET.",
  walk_not_done: "This walk is still being checked.",
  server_error: "The results could not be read. Try again.",
};

const fail = (code: Failure): Response =>
  Response.json({ error: { code, message: MESSAGE[code] } }, { status: STATUS[code], ...(code === "method_not_allowed" ? { headers: { allow: "GET" } } : {}) });

export class ReadRefused extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ReadRefused";
  }
}

const ownWalk = async (request: Request, db: D1Database, walkId: string): Promise<WalkRecord | Failure> => {
  if (!Id.safeParse(walkId).success) return "unknown_walk";
  const visitor = request.headers.get(VISITOR_HEADER);
  if (visitor === null || !Fingerprint.safeParse(visitor).success) return "invalid_request";
  const walk = await getWalk(db, walkId);
  return walk === null || walk.visitorId !== visitor ? "unknown_walk" : walk;
};

export const clipStart = (tags: Tag[], kind: ClipKind): number => {
  const own = tags.filter((t) => t.kind === kind);
  return own.length === 0 ? 0 : Math.min(...own.map((t) => t.startSeconds));
};

const sourcesOf = (ruleIds: string[]): ResultSource[] => {
  const seen = new Map<string, ResultSource>();
  for (const id of ruleIds) {
    const rule = RULES.find((r) => r.id === id);
    if (rule === undefined) throw new ReadRefused(`rule ${id} is not in the rule table`);
    if (!seen.has(rule.citation))
      seen.set(rule.citation, { citation: rule.citation, words: rule.requirement, status: rule.status, url: rule.sourceUrl, retrievedOn: rule.retrievedOn });
  }
  if (seen.size === 0) throw new ReadRefused("a finding cites no rule");
  return [...seen.values()];
};

const resultOf = (f: Finding, clips: Clip[], detections: Map<string, Detections>, tags: Tag[]): ResultFinding => {
  const clip = clips.find((c) => c.id === f.proofFrame.clipId);
  if (clip === undefined) throw new ReadRefused(`finding ${f.id} names a clip the walk does not have`);
  const tracks = detections.get(clip.id)?.tracks ?? [];
  const track = f.trackIds.map((id) => tracks.find((t) => t.id === id)).find((t) => t !== undefined);
  const frame = track?.frames.find((fr) => fr.frame === f.proofFrame.frame);
  if (frame === undefined) throw new ReadRefused(`finding ${f.id} has no box on its proof frame`);
  return {
    id: f.id,
    concept: f.concept,
    band: f.band,
    distanceFeet: f.distanceFeet,
    label: f.label,
    instruction: f.instruction,
    sources: sourcesOf(f.ruleIds),
    confidence: frame.confidence,
    proof: { still: stillPath(f.walkId, f.id), frame: f.proofFrame.frame, seconds: clipStart(tags, clip.kind) + f.proofFrame.frame / clip.fps, marker: frame.box },
    voiceNote: f.voiceNote,
  };
};

const checkedOf = async (db: D1Database, walkId: string): Promise<{ findings: ResultFinding[]; notChecked: Concept[] }> => {
  const findings = (await findingsForWalk(db, walkId)).filter((f) => f.veto === null);
  const clips = await clipsForWalk(db, walkId);
  const tags = await tagsForWalk(db, walkId);
  const detections = new Map(await Promise.all(clips.map(async (c) => [c.id, await detectionsForClip(db, c.id)] as const)));
  const notChecked = [...detections.values()].flatMap((d) => d.runs.filter((r) => r.outcome === "not_checked").map((r) => r.concept));
  return { findings: findings.map((f) => resultOf(f, clips, detections, tags)), notChecked };
};

const coverageRecordOf = async (media: R2Bucket, walkId: string): Promise<CoverageRecord | null> => {
  const stored = await media.get(coverageKey(walkId));
  if (stored === null) return null;
  const record = CoverageRecord.parse(await stored.json());
  if (record.walkId !== walkId) throw new ReadRefused(`the coverage record under walk ${walkId} belongs to walk ${record.walkId}`);
  return record;
};

export const resultsFor = async (db: D1Database, media: R2Bucket, walk: WalkRecord): Promise<WalkResultsResponse> => {
  const parts = await partsOf(db, walk.id);
  const covered = new Set(parts.map((p) => p.side));
  const own = (await gapsForWalk(db, walk.id)).filter((g) => !covered.has(g.side));
  const partGaps = await Promise.all(parts.map(async (p) => (await gapsForWalk(db, p.walkId)).filter((g) => g.side === p.side)));
  const checked = await Promise.all([walk.id, ...parts.map((p) => p.walkId)].map((id) => checkedOf(db, id)));
  const record = await coverageRecordOf(media, walk.id);
  const gaps = [...own, ...partGaps.flat()].sort(byWalkingOrder);
  const notChecked = [...new Set(checked.flatMap((c) => c.notChecked))];
  return WalkResultsResponse.parse({
    walkId: walk.id,
    walkedOn: walk.createdAt.slice(0, 10),
    synthetic: walk.synthetic,
    coverage: record?.coverage === "checked" && gaps.length === 0 && notChecked.length === 0 ? "checked" : "not_checked",
    loop: record?.loop ?? "not_checked",
    gaps,
    parts,
    findings: checked.flatMap((c) => c.findings),
    notChecked,
  });
};

const status = (walk: WalkRecord): WalkStatusResponse => ({ walkId: walk.id, state: walk.state, failure: walk.failure });

const still = async (db: D1Database, media: R2Bucket, walk: WalkRecord, findingId: string): Promise<Response> => {
  if (!Id.safeParse(findingId).success) return fail("not_found");
  const finding = (await findingsForWalk(db, walk.id)).find((f) => f.id === findingId && f.veto === null);
  if (finding === undefined) return fail("not_found");
  const { clipId, frame, still: key } = finding.proofFrame;
  if (key !== `stills/${walk.id}/${clipId}/${frame}.jpg`) return fail("not_found");
  const object = await media.get(key);
  if (object === null) return fail("not_found");
  return new Response(object.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
};

export const handleWalkRead = async (request: Request, env: { DB: D1Database; MEDIA: R2Bucket }, match: RegExpExecArray): Promise<Response> => {
  if (request.method !== "GET") return fail("method_not_allowed");
  const [, walkId = "", results, findingId] = match;
  try {
    const walk = await ownWalk(request, env.DB, walkId);
    if (typeof walk === "string") return fail(walk);
    if (results === undefined && findingId === undefined) return Response.json(status(walk));
    if (walk.state.name !== "done") return fail("walk_not_done");
    if (findingId !== undefined) return await still(env.DB, env.MEDIA, walk, findingId);
    return Response.json(await resultsFor(env.DB, env.MEDIA, walk));
  } catch (error) {
    console.warn(`walk ${walkId} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return fail("server_error");
  }
};

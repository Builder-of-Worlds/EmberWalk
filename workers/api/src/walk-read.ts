import {
  byWalkingOrder,
  clipsForWalk,
  type Detections,
  detectionsForClip,
  findingsForWalk,
  gapsForWalk,
  getWalk,
  partOfWalk,
  partsOf,
  tagsForWalk,
  walkedDay,
  type WalkRecord,
} from "@emberwalk/db";
import { CoverageRecord, coverageKey, RULES, templateInstruction, unplacedOf } from "@emberwalk/rules";
import { managesWalk, reachesThroughSession, shouldSignInAgain } from "./account.ts";
import {
  type Clip,
  type ClipKind,
  type Concept,
  type Corner,
  Fingerprint,
  type Finding,
  Id,
  type Language,
  type MapPin,
  PIN_SIDES_CLOCKWISE,
  type ResultFinding,
  type ResultSource,
  previewKey,
  previewPath,
  SecondCheck,
  secondCheckKey,
  type Side,
  SIDES,
  stillPath,
  type Tag,
  tagCorner,
  tagSide,
  VISITOR_HEADER,
  WalkResultsResponse,
  type WalkStatusResponse,
} from "@emberwalk/shared";

export const READ_PATH = /^\/api\/walks\/([^/]+)(?:\/(results)|\/(stills|previews)\/([^/]+))?$/;

type SecondChecks = Record<string, SecondCheck>;

type Failure = "invalid_request" | "sign_in_again" | "unknown_walk" | "not_found" | "method_not_allowed" | "walk_not_done" | "server_error";

const STATUS: Record<Failure, number> = {
  invalid_request: 400,
  sign_in_again: 401,
  unknown_walk: 404,
  not_found: 404,
  method_not_allowed: 405,
  walk_not_done: 409,
  server_error: 500,
};

const MESSAGE: Record<Failure, string> = {
  invalid_request: "The request is not valid.",
  sign_in_again: "Sign in again to see this walk.",
  unknown_walk: "That walk does not exist.",
  not_found: "That picture does not exist.",
  method_not_allowed: "Use GET.",
  walk_not_done: "This walk is still being checked.",
  server_error: "The results could not be read. Try again.",
};

const fail = (code: Failure): Response =>
  Response.json({ error: { code: code === "sign_in_again" ? "unknown_walk" : code, message: MESSAGE[code] } }, { status: STATUS[code], ...(code === "method_not_allowed" ? { headers: { allow: "GET" } } : {}) });

export class ReadRefused extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ReadRefused";
  }
}

export const ownWalk = async (request: Request, db: D1Database, walkId: string): Promise<WalkRecord | Failure> => {
  if (!Id.safeParse(walkId).success) return "unknown_walk";
  const visitor = request.headers.get(VISITOR_HEADER);
  if (visitor === null || !Fingerprint.safeParse(visitor).success) return "invalid_request";
  const walk = await getWalk(db, walkId);
  if (walk === null) return "unknown_walk";
  if (walk.visitorId === visitor || (await reachesThroughSession(request, db, walk.visitorId)) || (await managesWalk(request, db, walkId))) return walk;
  return (await shouldSignInAgain(request, db, walk.visitorId, visitor)) ? "sign_in_again" : "unknown_walk";
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

export type Extras = { previewed: Set<string>; checks: SecondChecks; language: Language };

const instructionsOf = (f: Finding, language: Language): { en: string; es: string } => {
  const rule = RULES.find((r) => r.id === f.ruleIds[0]);
  if (rule === undefined) throw new ReadRefused(`rule ${f.ruleIds[0]} is not in the rule table`);
  const inLanguage = (wanted: Language) => (wanted === language ? f.instruction : templateInstruction(rule, f.plantState, wanted));
  return { en: inLanguage("en"), es: inLanguage("es") };
};

// Dry grass is one finding per band around the whole house, so it names every side a sighting of it fell on.
const sidesOf = (f: Finding, clips: Clip[], detections: Map<string, Detections>, tags: Tag[]): Side[] => {
  const seen = new Set<Side>();
  for (const clip of clips)
    for (const track of (detections.get(clip.id)?.tracks ?? []).filter((t) => f.trackIds.includes(t.id)))
      for (const fr of track.frames) {
        const t = clipStart(tags, clip.kind) + fr.frame / clip.fps;
        const tag = tags.find((g) => g.kind === clip.kind && t >= g.startSeconds && t <= g.endSeconds);
        const side = tag === undefined ? null : tagSide(tag);
        if (side !== null) seen.add(side);
      }
  return SIDES.filter((s) => seen.has(s));
};

export const resultOf = (f: Finding, clips: Clip[], detections: Map<string, Detections>, tags: Tag[], extras: Extras): ResultFinding => {
  const clip = clips.find((c) => c.id === f.proofFrame.clipId);
  if (clip === undefined) throw new ReadRefused(`finding ${f.id} names a clip the walk does not have`);
  const tracks = detections.get(clip.id)?.tracks ?? [];
  const onProof = tracks.filter((t) => f.trackIds.includes(t.id)).flatMap((t) => t.frames.filter((fr) => fr.frame === f.proofFrame.frame));
  const frame = onProof.reduce<(typeof onProof)[number] | undefined>((best, fr) => (best === undefined || fr.confidence > best.confidence ? fr : best), undefined);
  if (frame === undefined) throw new ReadRefused(`finding ${f.id} has no box on its proof frame`);
  return {
    id: f.id,
    concept: f.concept,
    band: f.band,
    distanceFeet: f.contact === "yes" ? { low: 0, high: 0 } : f.distanceFeet,
    label: f.label,
    instruction: f.instruction,
    instructions: instructionsOf(f, extras.language),
    ...(RULES.find((r) => r.id === f.ruleIds[0])?.advice === true ? { advice: true as const } : {}),
    sources: sourcesOf(f.ruleIds),
    confidence: frame.confidence,
    proof: { still: stillPath(f.walkId, f.id), frame: f.proofFrame.frame, seconds: clipStart(tags, clip.kind) + f.proofFrame.frame / clip.fps, marker: frame.box },
    voiceNote: f.voiceNote,
    ...(extras.previewed.has(f.id) ? { preview: previewPath(f.walkId, f.id) } : {}),
    ...(extras.checks[f.id] === undefined ? {} : { secondCheck: extras.checks[f.id] }),
    ...(f.concept === "dry_grass" ? { sides: sidesOf(f, clips, detections, tags) } : {}),
  };
};

export const PIN_FEET = 100;

type SidedTag = { tag: Tag; side: Side };

const sidedLoop = (tags: Tag[]): SidedTag[] =>
  tags
    .filter((tag) => tag.kind === "loop")
    .flatMap((tag) => {
      const side = tagSide(tag);
      return side === null ? [] : [{ tag, side }];
    })
    .sort((a, b) => a.tag.startSeconds - b.tag.startSeconds);

const clockwise = (loop: SidedTag[]): boolean => {
  const turn = loop.findIndex((s, i) => i > 0 && s.side !== loop[i - 1]!.side);
  return turn >= 0 && PIN_SIDES_CLOCKWISE[(PIN_SIDES_CLOCKWISE.indexOf(loop[turn - 1]!.side) + 1) % PIN_SIDES_CLOCKWISE.length] === loop[turn]!.side;
};

const CORNER_SPOTS: Record<Corner, { side: Side; position: number }> = {
  front_right: { side: "front", position: 0 },
  front_left: { side: "left", position: 0 },
  back_left: { side: "back", position: 0 },
  back_right: { side: "right", position: 0 },
};

const panSpot = (at: number, tags: Tag[]): { side: Side; position: number } | null => {
  const pans = tags.filter((tag) => tag.kind === "pan").sort((a, b) => a.startSeconds - b.startSeconds);
  const own = pans.find((tag, i) => at >= tag.startSeconds && (at < tag.endSeconds || (i === pans.length - 1 && at === tag.endSeconds)));
  if (own === undefined) return null;
  const corner = tagCorner(own);
  return corner === null ? null : CORNER_SPOTS[corner];
};

const pinOf = (f: ResultFinding, kind: ClipKind, tags: Tag[], loop: SidedTag[], forward: boolean): MapPin | null => {
  const feet = f.distanceFeet.low;
  if (feet >= PIN_FEET) return null;
  const at = f.proof.seconds;
  if (kind === "pan") {
    const spot = panSpot(at, tags);
    return spot === null ? null : { findingId: f.id, band: f.band, feet, ...spot };
  }
  const own = loop.find(({ tag }, i) => at >= tag.startSeconds && (at < tag.endSeconds || (i === loop.length - 1 && at === tag.endSeconds)));
  if (own === undefined) return null;
  const span = own.tag.endSeconds - own.tag.startSeconds;
  const along = span > 0 ? (at - own.tag.startSeconds) / span : 0;
  return { findingId: f.id, side: own.side, band: f.band, position: forward ? along : 1 - along, feet };
};

const secondChecksOf = async (media: R2Bucket, walkId: string): Promise<SecondChecks> => {
  const stored = await media.get(secondCheckKey(walkId)).catch(() => null);
  if (stored === null) return {};
  const record: unknown = await stored.json().catch(() => null);
  if (typeof record !== "object" || record === null || Array.isArray(record)) return {};
  return Object.fromEntries(Object.entries(record).filter(([id, check]) => Id.safeParse(id).success && SecondCheck.safeParse(check).success));
};

const previewedOf = async (media: R2Bucket, walkId: string, findings: Finding[]): Promise<Set<string>> => {
  const heads = await Promise.all(findings.map(async (f) => [f.id, await media.head(previewKey(walkId, f.id)).catch(() => null)] as const));
  return new Set(heads.filter(([, head]) => head !== null).map(([id]) => id));
};

const checkedOf = async (db: D1Database, media: R2Bucket, walkId: string): Promise<{ findings: ResultFinding[]; notChecked: Concept[]; pins: MapPin[] }> => {
  const findings = (await findingsForWalk(db, walkId)).filter((f) => f.veto === null);
  const clips = await clipsForWalk(db, walkId);
  const tags = await tagsForWalk(db, walkId);
  const detections = new Map(await Promise.all(clips.map(async (c) => [c.id, await detectionsForClip(db, c.id)] as const)));
  const notChecked = [...detections.values()].flatMap((d) => d.runs.filter((r) => r.outcome === "not_checked").map((r) => r.concept));
  const language = (await getWalk(db, walkId))?.language ?? "en";
  const extras = { previewed: await previewedOf(media, walkId, findings), checks: await secondChecksOf(media, walkId), language };
  const results = findings.map((f) => resultOf(f, clips, detections, tags, extras));
  const loop = sidedLoop(tags);
  const forward = clockwise(loop);
  const pins = results.flatMap((r, i) => {
    const kind = clips.find((c) => c.id === findings[i]!.proofFrame.clipId)!.kind;
    return pinOf(r, kind, tags, loop, forward) ?? [];
  });
  return { findings: results, notChecked, pins };
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
  const checked = await Promise.all([walk.id, ...parts.map((p) => p.walkId)].map((id) => checkedOf(db, media, id)));
  const record = await coverageRecordOf(media, walk.id);
  const gaps = [...own, ...partGaps.flat()].sort(byWalkingOrder);
  const notChecked = [...new Set(checked.flatMap((c) => c.notChecked))];
  const unplaced = (await Promise.all([walk.id, ...parts.map((p) => p.walkId)].map((id) => unplacedOf(media, id))))
    .flat()
    .filter((u) => u.why === "not_measured")
    .map(({ concept, side }) => ({ concept, side }))
    .filter((u, i, all) => all.findIndex((v) => v.concept === u.concept && v.side === u.side) === i);
  return WalkResultsResponse.parse({
    walkId: walk.id,
    walkedOn: walkedDay(walk),
    synthetic: walk.synthetic,
    coverage: record?.coverage === "checked" && gaps.length === 0 && notChecked.length === 0 && unplaced.every((u) => u.side === null) ? "checked" : "not_checked",
    loop: record?.loop ?? "not_checked",
    gaps,
    parts,
    findings: checked.flatMap((c) => c.findings),
    notChecked,
    unplaced,
    pins: checked.flatMap((c) => c.pins),
  });
};

const status = async (db: D1Database, walk: WalkRecord): Promise<WalkStatusResponse> => {
  if (walk.failure === null) return { walkId: walk.id, state: walk.state, failure: null };
  const part = await partOfWalk(db, walk.id);
  return { walkId: walk.id, state: walk.state, failure: part === null ? walk.failure : { ...walk.failure, part: part.side } };
};

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

const preview = async (db: D1Database, media: R2Bucket, walk: WalkRecord, findingId: string): Promise<Response> => {
  if (!Id.safeParse(findingId).success) return fail("not_found");
  const finding = (await findingsForWalk(db, walk.id)).find((f) => f.id === findingId && f.veto === null);
  if (finding === undefined) return fail("not_found");
  const object = await media.get(previewKey(walk.id, finding.id));
  if (object === null) return fail("not_found");
  return new Response(object.body, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } });
};

export const handleWalkRead = async (request: Request, env: { DB: D1Database; MEDIA: R2Bucket }, match: RegExpExecArray): Promise<Response> => {
  if (request.method !== "GET") return fail("method_not_allowed");
  const [, walkId = "", results, picture, findingId] = match;
  try {
    const walk = await ownWalk(request, env.DB, walkId);
    if (typeof walk === "string") return fail(walk);
    if (results === undefined && findingId === undefined) return Response.json(await status(env.DB, walk));
    if (walk.state.name !== "done") return fail("walk_not_done");
    if (findingId !== undefined) return await (picture === "previews" ? preview : still)(env.DB, env.MEDIA, walk, findingId);
    return Response.json(await resultsFor(env.DB, env.MEDIA, walk));
  } catch (error) {
    console.warn(`walk ${walkId} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return fail("server_error");
  }
};

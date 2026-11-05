import { createWalk, gapsForWalk, getWalk, type NewWalk, partOfWalk, type PlanYearCap, PlanYearUsed, setWalkDay, WalkLimitReached } from "@emberwalk/db";
import { DEFAULT_LIMITS, StartWalkRequest } from "@emberwalk/shared";
import { reachesThroughSession, shouldSignInAgain } from "./account.ts";
import { billingFail } from "./billing-route.ts";

const MAX_BODY_BYTES = 16 * 1024;

const fail = (code: string, message: string, status: number, headers?: HeadersInit): Response =>
  Response.json({ error: { code, message } }, { status, ...(headers === undefined ? {} : { headers }) });

const invalid = (): Response => fail("invalid_request", "The request is not valid.", 400);

export const movedParentAnswer = async (asked: Request, db: D1Database, parentId: string, phone: string): Promise<Response | null> => {
  const parent = await getWalk(db, parentId);
  if (parent === null || parent.visitorId === phone || (await reachesThroughSession(asked, db, parent.visitorId))) return null;
  return (await shouldSignInAgain(asked, db, parent.visitorId, phone)) ? fail("unknown_walk", "Sign in again to see this walk.", 401) : null;
};

const asPart = async (db: D1Database, request: StartWalkRequest, asked: Request): Promise<Omit<NewWalk, "id"> | Response> => {
  const { partOf } = request;
  if (partOf === null) return request;
  const moved = await movedParentAnswer(asked, db, partOf.walkId, request.visitorId);
  if (moved !== null) return moved;
  const parent = await getWalk(db, partOf.walkId);
  if (parent === null || (parent.visitorId !== request.visitorId && !(await reachesThroughSession(asked, db, parent.visitorId)))) return fail("unknown_walk", "That walk does not exist.", 404);
  if (parent.state.name !== "done") return fail("walk_not_done", "This walk is still being checked.", 409);
  if (parent.synthetic || (await partOfWalk(db, parent.id)) !== null) return invalid();
  if (!(await gapsForWalk(db, parent.id)).some((gap) => gap.side === partOf.side)) return invalid();
  return { ...request, language: parent.language, jurisdiction: parent.jurisdiction, synthetic: parent.synthetic };
};

const startOfDay = (now: Date): string => `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;

const DAY_MS = 24 * 60 * 60 * 1000;
const OLDEST_UNSENT_DAYS = 30;

const dayIsBelievable = (day: string, now: Date): boolean => {
  const at = Date.parse(`${day}T00:00:00.000Z`);
  return at <= now.getTime() + DAY_MS && at >= now.getTime() - OLDEST_UNSENT_DAYS * DAY_MS;
};

const keepWalkDay = async (db: D1Database, walkId: string, day: string): Promise<void> => {
  try {
    await setWalkDay(db, walkId, day);
  } catch (error) {
    console.warn(`walk ${walkId} keeps the server's day: ${error instanceof Error ? error.message : String(error)}`);
  }
};

export const keyedId = async (visitorId: string, startKey: string): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${visitorId}:${startKey}`)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const startedBefore = async (db: D1Database, id: string, visitorId: string, keyed: boolean, asked: Request): Promise<Response | null> => {
  if (!keyed) return null;
  const walk = await getWalk(db, id);
  return walk !== null && (walk.visitorId === visitorId || (await reachesThroughSession(asked, db, walk.visitorId))) ?Response.json({ walkId: walk.id, state: walk.state }) : null;
};

export const handleCreateWalk = async (
  request: Request,
  db: D1Database,
  newId: () => string,
  now: () => Date = () => new Date(),
  planYear?: PlanYearCap,
): Promise<Response> => {
  if (request.method !== "POST") return fail("method_not_allowed", "Use POST.", 405, { allow: "POST" });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail("body_too_large", "The request body is too large.", 413);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return invalid();
  }
  const parsed = StartWalkRequest.safeParse(json);
  if (!parsed.success) return invalid();
  const { startKey, partOf, language, jurisdiction, device, synthetic, visitorId } = parsed.data;
  const wanted = { partOf, language, jurisdiction, device, synthetic, visitorId };
  const keyed = startKey !== undefined;
  try {
    const id = keyed ? await keyedId(wanted.visitorId, startKey) : newId();
    const walk = await asPart(db, wanted, request);
    if (walk instanceof Response) return walk;
    const cap = (walk.partOf ?? null) === null ? { since: startOfDay(now()), most: DEFAULT_LIMITS.liveWalksPerVisitorPerDay } : undefined;
    try {
      const created = await createWalk(db, { id, ...walk }, cap, cap === undefined ? undefined : planYear);
      if (parsed.data.walkedOn !== undefined && dayIsBelievable(parsed.data.walkedOn, now())) await keepWalkDay(db, created.id, parsed.data.walkedOn);
      return Response.json({ walkId: created.id, state: created.state });
    } catch (err) {
      const before = await startedBefore(db, id, wanted.visitorId, keyed, request);
      if (before !== null) return before;
      throw err;
    }
  } catch (err) {
    if (err instanceof PlanYearUsed) return billingFail("walks_used");
    if (err instanceof WalkLimitReached) return fail("walk_limit_reached", "You have sent as many walks as EmberWalk allows today. Try again tomorrow.", 429);
    return fail("server_error", "The walk could not be created. Try again.", 500);
  }
};

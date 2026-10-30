import { createWalk, gapsForWalk, getWalk, type NewWalk, partOfWalk, WalkLimitReached } from "@emberwalk/db";
import { DEFAULT_LIMITS, StartWalkRequest } from "@emberwalk/shared";

const MAX_BODY_BYTES = 16 * 1024;

const fail = (code: string, message: string, status: number, headers?: HeadersInit): Response =>
  Response.json({ error: { code, message } }, { status, ...(headers === undefined ? {} : { headers }) });

const invalid = (): Response => fail("invalid_request", "The request is not valid.", 400);

const asPart = async (db: D1Database, request: StartWalkRequest): Promise<Omit<NewWalk, "id"> | Response> => {
  const { partOf } = request;
  if (partOf === null) return request;
  const parent = await getWalk(db, partOf.walkId);
  if (parent === null || parent.visitorId !== request.visitorId) return fail("unknown_walk", "That walk does not exist.", 404);
  if (parent.state.name !== "done") return fail("walk_not_done", "This walk is still being checked.", 409);
  if (parent.synthetic || (await partOfWalk(db, parent.id)) !== null) return invalid();
  if (!(await gapsForWalk(db, parent.id)).some((gap) => gap.side === partOf.side)) return invalid();
  return { ...request, language: parent.language, jurisdiction: parent.jurisdiction, synthetic: parent.synthetic };
};

const startOfDay = (now: Date): string => `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;

const keyedId = async (visitorId: string, startKey: string): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${visitorId}:${startKey}`)));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const startedBefore = async (db: D1Database, id: string, visitorId: string, keyed: boolean): Promise<Response | null> => {
  if (!keyed) return null;
  const walk = await getWalk(db, id);
  return walk !== null && walk.visitorId === visitorId ? Response.json({ walkId: walk.id, state: walk.state }) : null;
};

export const handleCreateWalk = async (request: Request, db: D1Database, newId: () => string, now: () => Date = () => new Date()): Promise<Response> => {
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
  const { startKey, ...wanted } = parsed.data;
  const keyed = startKey !== undefined;
  try {
    const id = keyed ? await keyedId(wanted.visitorId, startKey) : newId();
    const walk = await asPart(db, wanted);
    if (walk instanceof Response) return walk;
    const cap = (walk.partOf ?? null) === null ? { since: startOfDay(now()), most: DEFAULT_LIMITS.liveWalksPerVisitorPerDay } : undefined;
    try {
      const created = await createWalk(db, { id, ...walk }, cap);
      return Response.json({ walkId: created.id, state: created.state });
    } catch (err) {
      const before = await startedBefore(db, id, wanted.visitorId, keyed);
      if (before !== null) return before;
      throw err;
    }
  } catch (err) {
    if (err instanceof WalkLimitReached) return fail("walk_limit_reached", "You have sent as many walks as EmberWalk allows today. Try again tomorrow.", 429);
    return fail("server_error", "The walk could not be created. Try again.", 500);
  }
};

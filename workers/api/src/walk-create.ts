import { createWalk, gapsForWalk, getWalk, type NewWalk, partOfWalk } from "@emberwalk/db";
import { StartWalkRequest } from "@emberwalk/shared";

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

export const handleCreateWalk = async (request: Request, db: D1Database, newId: () => string): Promise<Response> => {
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
  try {
    const walk = await asPart(db, parsed.data);
    if (walk instanceof Response) return walk;
    const created = await createWalk(db, { id: newId(), ...walk });
    return Response.json({ walkId: created.id, state: created.state });
  } catch {
    return fail("server_error", "The walk could not be created. Try again.", 500);
  }
};

import { createWalk } from "@emberwalk/db";
import { StartWalkRequest } from "@emberwalk/shared";

const MAX_BODY_BYTES = 16 * 1024;

const fail = (code: string, message: string, status: number, headers?: HeadersInit): Response =>
  Response.json({ error: { code, message } }, { status, ...(headers === undefined ? {} : { headers }) });

export const handleCreateWalk = async (request: Request, db: D1Database, newId: () => string): Promise<Response> => {
  if (request.method !== "POST") return fail("method_not_allowed", "Use POST.", 405, { allow: "POST" });
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail("body_too_large", "The request body is too large.", 413);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("invalid_request", "The request is not valid.", 400);
  }
  const parsed = StartWalkRequest.safeParse(json);
  if (!parsed.success) return fail("invalid_request", "The request is not valid.", 400);
  try {
    const walk = await createWalk(db, { id: newId(), ...parsed.data });
    return Response.json({ walkId: walk.id, state: walk.state });
  } catch {
    return fail("server_error", "The walk could not be created. Try again.", 500);
  }
};

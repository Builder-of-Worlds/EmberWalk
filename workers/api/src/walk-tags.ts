import { addTag } from "@emberwalk/db";
import { Id, Tag } from "@emberwalk/shared";
import { d1WalkGate } from "./walk-gate.ts";

export const MAX_TAGS_PER_WALK = 20;
export const MAX_BODY_BYTES = 1024 * 1024;

type Failure = "invalid_request" | "body_too_large" | "unknown_walk" | "walk_not_uploading" | "method_not_allowed" | "server_error";

const STATUS: Record<Failure, number> = {
  invalid_request: 400,
  unknown_walk: 404,
  method_not_allowed: 405,
  walk_not_uploading: 409,
  body_too_large: 413,
  server_error: 500,
};

const MESSAGE: Record<Failure, string> = {
  invalid_request: "The request is not valid.",
  unknown_walk: "That walk does not exist.",
  method_not_allowed: "Use POST.",
  walk_not_uploading: "That walk is not waiting for its video.",
  body_too_large: "The request body is too large.",
  server_error: "The tags could not be saved. Try again.",
};

const fail = (code: Failure, headers?: HeadersInit): Response =>
  Response.json({ error: { code, message: MESSAGE[code] } }, { status: STATUS[code], ...(headers === undefined ? {} : { headers }) });

const tagsIn = (json: unknown, walkId: string): Tag[] | null => {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const keys = Object.keys(json);
  const tags = (json as { tags?: unknown }).tags;
  if (keys.length !== 1 || !Array.isArray(tags) || tags.length > MAX_TAGS_PER_WALK) return null;
  const parsed: Tag[] = [];
  for (const candidate of tags) {
    const result = Tag.safeParse(candidate);
    if (!result.success || result.data.walkId !== walkId) return null;
    parsed.push(result.data);
  }
  return new Set(parsed.map((tag) => tag.id)).size === parsed.length ? parsed : null;
};

const storedCount = async (db: D1Database, walkId: string): Promise<number> => {
  const row = await db.prepare("SELECT count(*) AS n FROM tags WHERE walk_id = ?").bind(walkId).first<{ n: number }>();
  return row === null ? 0 : row.n;
};

export const handleAddTags = async (request: Request, db: D1Database, walkId: string): Promise<Response> => {
  if (request.method !== "POST") return fail("method_not_allowed", { allow: "POST" });
  if (!Id.safeParse(walkId).success) return fail("unknown_walk");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return fail("body_too_large");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fail("invalid_request");
  }
  const tags = tagsIn(json, walkId);
  if (tags === null) return fail("invalid_request");

  const added: string[] = [];
  try {
    const state = await d1WalkGate(db).state(walkId);
    if (state === null) return fail("unknown_walk");
    if (state !== "uploading") return fail("walk_not_uploading");
    if ((await storedCount(db, walkId)) + tags.length > MAX_TAGS_PER_WALK) return fail("invalid_request");
    for (const tag of tags) {
      await addTag(db, tag);
      added.push(tag.id);
    }
    return Response.json({ walkId, tags: tags.length });
  } catch {
    await takeBack(db, walkId, added);
    return fail("server_error");
  }
};

const takeBack = async (db: D1Database, walkId: string, ids: string[]): Promise<void> => {
  try {
    await db.batch(ids.map((id) => db.prepare("DELETE FROM tags WHERE id = ? AND walk_id = ?").bind(id, walkId)));
  } catch {
    console.warn(`tags of walk ${walkId} could not be taken back`);
  }
};

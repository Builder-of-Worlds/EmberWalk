import { DirectoryRefused, FIRE_LINKS, nearestCrews, UnknownZip } from "@emberwalk/directory";
import type { Trade } from "@emberwalk/directory";

const fail = (code: string, message: string, status: number, headers?: HeadersInit): Response =>
  Response.json({ error: { code, message } }, { status, ...(headers === undefined ? {} : { headers }) });

const notGet = (): Response => fail("method_not_allowed", "Use GET.", 405, { allow: "GET" });

const number = (text: string | null): number => (text === null || text.trim() === "" ? Number.NaN : Number(text));

const trades = (text: string | null): Trade | Trade[] => (text !== null && text.includes(",") ? (text.split(",") as Trade[]) : (text as Trade));

export const handleFireLinks = (request: Request): Response => (request.method === "GET" ? Response.json({ links: FIRE_LINKS }) : notGet());

export const handleCrewSearch = async (request: Request, db: D1Database): Promise<Response> => {
  if (request.method !== "GET") return notGet();
  const params = new URL(request.url).searchParams;
  const lat = params.get("lat");
  const lng = params.get("lng");
  if ((lat === null) !== (lng === null)) return fail("invalid_request", "The request is not valid.", 400);
  const limit = params.get("limit");
  const zip = params.get("zip");
  try {
    const found = await nearestCrews(db, {
      trade: trades(params.get("trade")),
      ...(zip === null ? {} : { zip }),
      ...(lat === null ? {} : { location: { lat: number(lat), lng: number(lng) } }),
      ...(limit === null ? {} : { limit: number(limit) }),
    });
    return Response.json(found);
  } catch (error) {
    if (error instanceof UnknownZip) return fail("zip_not_found", "That ZIP code could not be found, so crews cannot be measured from it.", 404);
    if (error instanceof DirectoryRefused) return fail("invalid_request", "The request is not valid.", 400);
    return fail("server_error", "The crews could not be listed.", 500);
  }
};

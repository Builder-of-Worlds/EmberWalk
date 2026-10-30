import { DurableObject } from "cloudflare:workers";

export const STAND_IN_PROBE = { bytes: 2048, durationSeconds: 12.5, isMp4: true };

export class MediaStandIn extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    const body = (await request.json()) as { input?: string };
    if (pathname !== "/probe") return Response.json({ error: { code: "not_found", message: "No such operation." } }, { status: 404 });
    if (body.input === "refuse") return Response.json({ error: { code: "not_a_video", message: "That file is not a video." } }, { status: 422 });
    if (body.input === "break") return new Response("broken", { status: 500 });
    return Response.json(STAND_IN_PROBE);
  }
}

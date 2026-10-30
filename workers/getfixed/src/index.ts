import { depsFrom } from "./deps.ts";
import type { Env } from "./env.ts";
import { receive } from "./inbound.ts";

export { GetFixed } from "./service.ts";
export { FollowUpTimer } from "./timer.ts";

export default {
  async fetch(request): Promise<Response> {
    if (request.method === "GET" && new URL(request.url).pathname === "/health") return Response.json({ status: "ok" });
    return Response.json({ error: { code: "not_found", message: "No such endpoint." } }, { status: 404 });
  },
  async email(message, env): Promise<void> {
    await receive(depsFrom(env), message);
  },
} satisfies ExportedHandler<Env>;
